import { CAFE_MEMBER_LIST } from '../shared/cafeMemberFixture.js'
import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import type { CollectedMemberPage } from '../shared/cafeMemberList.js'
import type { Random } from '../shared/ports.js'
import type { CreateMemberRunInput, MemberFeedState, MemberRepository } from './collection-db/memberRepository.js'
import { collectionDelayMs } from './collectionOrchestrator.js'
import { locateMemberResumePosition, type MemberScheduledReader } from './memberCollectionResume.js'
import type { ExtensionTransport } from './ws/server.js'

export interface MemberCollectionClock { now(): number }
export interface MemberPageFetcher { read(page: number): Promise<CollectedMemberPage> }
export type MemberRunMode = 'backfill' | 'incremental' | 'topup'

export interface MemberCollectionRunOptions {
  readonly run: CreateMemberRunInput
  readonly maxPages: number
  readonly mode: MemberRunMode
  readonly maxProbePages?: number
}

export type MemberCollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number }
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly reason: 'PAGE_BUDGET_SPENT' }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly code: string }

export interface MemberCollectionOrchestratorDeps {
  readonly repository: MemberRepository
  readonly fetcher: MemberPageFetcher
  readonly clock: MemberCollectionClock
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  readonly isAbortRequested: () => boolean
}

export class MemberCollectionPageError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'MemberCollectionPageError'
  }
}

/** A full page is 100 members; fewer means the last page has been reached. */
export const MEMBERS_PER_PAGE = 100
/** The top-up walk reads at most this many pages before stopping regardless. */
export const TOPUP_MAX_PAGES = 5

export function createMemberCollectionFetcher(transport: ExtensionTransport, newRequestId: () => string): MemberPageFetcher {
  return {
    async read(page) {
      const message: Extract<AppMessage, { type: 'COLLECT_MEMBER_PAGE' }> = {
        type: 'COLLECT_MEMBER_PAGE',
        requestId: newRequestId(),
        cafeId: CAFE_MEMBER_LIST.cafeId,
        page,
        perPage: CAFE_MEMBER_LIST.perPage,
      }
      const reply = await transport.request(message, TIMEOUTS.memberPageMs)
      if (reply.type === 'MEMBER_PAGE_COLLECTED') return reply.result
      if (reply.type === 'ERROR') throw new MemberCollectionPageError(reply.code)
      throw new MemberCollectionPageError('MEMBER_PAGE_UNEXPECTED_REPLY')
    },
  }
}

/** Asserts that joinDate values are non-increasing across the page. */
function assertMemberPage(page: CollectedMemberPage): void {
  let previous: string | null = null
  for (const item of page.items) {
    if (previous !== null && item.joinDate > previous) {
      throw new MemberCollectionPageError('MEMBER_PAGE_DATE_ORDER')
    }
    previous = item.joinDate
  }
}

interface MemberScheduler extends MemberScheduledReader {
  readonly reads: number
}

function createScheduledReader(deps: MemberCollectionOrchestratorDeps, runId: string, maxPages: number, maxProbePages: number): MemberScheduler {
  let reads = 0
  let probes = 0
  const observations = new WeakMap<CollectedMemberPage, Date>()
  const read = async (page: number, phase: 'probe' | 'collection'): Promise<CollectedMemberPage> => {
    if (reads >= maxPages) throw new MemberCollectionPageError('MAX_PAGE_LIMIT')
    if (phase === 'probe' && probes >= maxProbePages) throw new MemberCollectionPageError('PROBE_PAGE_LIMIT')
    while (deps.isSessionBusy()) {
      if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
      await deps.sleep(1_000)
    }
    if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
    const delay = collectionDelayMs(reads + 1, deps.random)
    if (delay > 0) await deps.sleep(delay)
    while (deps.isSessionBusy()) {
      if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
      await deps.sleep(1_000)
    }
    if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')
    await deps.repository.recordPageRequest(runId, phase)
    reads += 1
    if (phase === 'probe') probes += 1
    const observedAt = new Date(deps.clock.now())
    const value = await deps.fetcher.read(page)
    assertMemberPage(value)
    observations.set(value, observedAt)
    return value
  }
  return {
    collect: (page) => read(page, 'collection'),
    probe: (page) => read(page, 'probe'),
    // Resume relocation reads count as discovery, not stored pages.
    observedAt(page) {
      const value = observations.get(page)
      if (value === undefined) throw new MemberCollectionPageError('MEMBER_PAGE_OBSERVATION_TIME_MISSING')
      return value
    },
    get reads() {
      return reads
    },
  }
}

async function persistSlice(
  deps: MemberCollectionOrchestratorDeps,
  runId: string,
  reader: MemberScheduler,
  observedPage: CollectedMemberPage,
  slicedPage: CollectedMemberPage,
  pageNumber: number,
  state: MemberFeedState,
): Promise<{ kind: 'stored'; state: MemberFeedState } | { kind: 'conflict' }> {
  const stored = await deps.repository.persistPage({
    runId,
    observedAt: reader.observedAt(observedPage),
    referencePage: pageNumber,
    expectedState: { stateVersion: state.stateVersion, anchorMemberKey: state.anchorMemberKey },
    page: slicedPage,
  })
  if (stored.kind === 'conflict') return { kind: 'conflict' }
  const tail = slicedPage.items.at(-1)
  return {
    kind: 'stored',
    state: {
      ...state,
      stateVersion: stored.nextStateVersion,
      anchorMemberKey: stored.anchorMemberKey,
      anchorJoinDate: tail?.joinDate ?? state.anchorJoinDate,
      referencePage: pageNumber,
      pageIdentity: slicedPage.pageIdentity,
      cursorUpdatedAtMs: deps.clock.now(),
    },
  }
}

export function createMemberCollectionOrchestrator(deps: MemberCollectionOrchestratorDeps) {
  return {
    async run(options: MemberCollectionRunOptions): Promise<MemberCollectionRunResult> {
      let pagesStored = 0
      try {
        const initial = await deps.repository.startRun(options.run)
        const reader = createScheduledReader(deps, options.run.id, options.maxPages, options.maxProbePages ?? 32)
        let state: MemberFeedState = initial

        // The top-up walk always starts at page 1 and stops when a whole page is
        // already known; the main walk resumes from the cursor when there is one.
        const resumed =
          options.mode !== 'topup' && state.anchorMemberKey !== null && state.anchorJoinDate !== null && state.referencePage !== null
            ? await locateMemberResumePosition(reader, {
                anchorMemberKey: state.anchorMemberKey,
                anchorJoinDate: state.anchorJoinDate,
                referencePage: state.referencePage,
              })
            : null
        if (resumed?.kind === 'unusable') throw new MemberCollectionPageError('MEMBER_ANCHOR_RELOCATION_FAILED')

        let pageNumber = resumed?.kind === 'found' ? resumed.page : 1
        let firstOffset = resumed?.kind === 'found' ? resumed.offset : 0
        let firstPage = resumed?.kind === 'found' ? resumed.candidate : null
        let previousTailKey: string | null = null
        let previousTailJoinDate: string | null = null
        let previousPageNumber = 0
        let previousIdentity: string | null = null
        let justRelocated = false

        // Tracks page identity → page number to detect silent API fallback
        // (when the API returns the first page's content for any out-of-range
        // page number, the same identity appears at a different page number).
        const seenIdentities = new Map<string, number>()

        while (true) {
          let currentPage = firstPage ?? (await reader.collect(pageNumber))
          firstPage = null

          if (previousTailKey !== null) {
            const surfaced = currentPage.items.findIndex((item) => item.memberKey === previousTailKey)
            if (surfaced >= 0) {
              firstOffset = surfaced + 1
            } else {
              const rewind = await reader.collect(previousPageNumber)
              if (rewind.pageIdentity === previousIdentity) {
                // Nothing shifted; the next page starts a clean segment.
                firstOffset = 0
              } else {
                const index = rewind.items.findIndex((item) => item.memberKey === previousTailKey)
                if (index >= 0 && index < rewind.items.length - 1) {
                  currentPage = rewind
                  pageNumber = previousPageNumber
                  firstOffset = index + 1
                } else if (index < 0) {
                  // Tail found nowhere in the rewound page — relocate.
                  const relocated = await locateMemberResumePosition(reader, {
                    anchorMemberKey: previousTailKey,
                    anchorJoinDate: previousTailJoinDate!,
                    referencePage: previousPageNumber,
                  })
                  if (relocated.kind !== 'found') throw new MemberCollectionPageError('MEMBER_ANCHOR_RELOCATION_FAILED')
                  currentPage = relocated.candidate
                  pageNumber = relocated.page
                  firstOffset = relocated.offset
                  // The overshoot branch of locateMemberResumePosition deliberately returns an
                  // earlier page at offset 0 so no member from that date block is skipped.
                  // From a fresh run, previousTailJoinDate is still null so the date guard
                  // below would not fire anyway; from this in-run relocation path it is set,
                  // and the earlier page's head is by definition newer — which would trip the
                  // guard falsely. The relocation has already validated its position against the
                  // anchor, and re-reading an earlier page is exactly what that branch exists to
                  // do. Set the flag here and clear it after the check so the guard is back in
                  // force from the next page onward.
                  justRelocated = true
                }
                // else: index === length - 1, tail at last position, next page starts clean (firstOffset = 0)
              }
            }
            if (currentPage.pageIdentity === previousIdentity) throw new MemberCollectionPageError('MEMBER_PAGE_REPEATED')
          }

          // Silent-fallback guard: if this page's identity was already seen at a
          // different page number in this run, the API silently returned an earlier
          // page. A rewind re-reads the same page number so it does not trip this.
          const priorPage = seenIdentities.get(currentPage.pageIdentity)
          if (priorPage !== undefined && priorPage !== pageNumber) {
            throw new MemberCollectionPageError('MEMBER_PAGE_SILENT_FALLBACK')
          }
          seenIdentities.set(currentPage.pageIdentity, pageNumber)

          if (deps.isAbortRequested()) throw new MemberCollectionPageError('ABORTED')

          const slice = currentPage.items.slice(firstOffset)
          firstOffset = 0

          // Run-independent silent-fallback guard: because the list is join-date
          // descending and each page is asserted non-increasing, the slice about to
          // be persisted can never contain a member newer than the previous committed
          // page's tail. If the slice's first join date is newer than the previous
          // tail's, this page is not a continuation — it is an earlier page silently
          // returned by the API. The check is on the resolved slice (not the raw
          // fetched page) so normal paths stay quiet: after a rewind the slice starts
          // after the tail; after a relocation the slice starts at the head of the
          // anchor's date block; in all three normal cases the slice's newest join
          // date is at most the previous tail's date. Only a page from elsewhere in
          // the list is newer.
          // Skip the guard on the iteration immediately after an in-run relocation:
          // that relocation's overshoot branch may return an earlier page at offset 0,
          // whose head is by definition newer than the previous tail. The flag is cleared
          // here so normal detection is back in force from the next page onward.
          const skipDateGuard = justRelocated
          justRelocated = false
          if (!skipDateGuard && previousTailJoinDate !== null && slice.length > 0 && slice[0]!.joinDate > previousTailJoinDate) {
            throw new MemberCollectionPageError('MEMBER_PAGE_SILENT_FALLBACK')
          }

          // Top-up ends when a full page brings nothing new. Members already in
          // the table are still upserted as a side effect, but the goal is only
          // the joiners at the front.
          if (options.mode === 'topup') {
            const known = await deps.repository.knownMemberKeys(slice.map((item) => item.memberKey))
            const fresh = slice.filter((item) => !known.has(item.memberKey))
            if (fresh.length === 0) {
              await deps.repository.markToppedUp(new Date(deps.clock.now()))
              await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
              return { kind: 'succeeded', pagesStored }
            }
          }

          if (slice.length > 0) {
            const slicedPage: CollectedMemberPage = { ...currentPage, items: slice }
            const result = await persistSlice(deps, options.run.id, reader, currentPage, slicedPage, pageNumber, state)
            if (result.kind === 'conflict') {
              await deps.repository.finishRun(options.run.id, 'partial', 'CAS_CONFLICT_REPOSITION_REQUIRED', new Date(deps.clock.now()))
              return { kind: 'cas_conflict', pagesStored }
            }
            state = result.state
            pagesStored += 1
          }

          // A short page is the last page: the whole walk is done.
          if (currentPage.items.length < MEMBERS_PER_PAGE) {
            if (options.mode !== 'topup') await deps.repository.markCompleted(new Date(deps.clock.now()))
            else await deps.repository.markToppedUp(new Date(deps.clock.now()))
            await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
            return { kind: 'succeeded', pagesStored }
          }

          if (options.mode === 'topup' && reader.reads >= TOPUP_MAX_PAGES) {
            await deps.repository.markToppedUp(new Date(deps.clock.now()))
            await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
            return { kind: 'succeeded', pagesStored }
          }

          const tail = currentPage.items.at(-1)
          if (tail === undefined) throw new MemberCollectionPageError('MEMBER_PAGE_EMPTY')
          previousTailKey = tail.memberKey
          previousTailJoinDate = tail.joinDate
          previousPageNumber = pageNumber
          previousIdentity = currentPage.pageIdentity
          pageNumber += 1
        }
      } catch (error) {
        const now = new Date(deps.clock.now())
        if (error instanceof MemberCollectionPageError && error.code === 'ABORTED') {
          await deps.repository.finishRun(options.run.id, 'interrupted', 'ABORTED', now).catch(() => undefined)
          return { kind: 'interrupted', pagesStored, reason: 'ABORTED' }
        }
        if (error instanceof MemberCollectionPageError && error.code === 'MAX_PAGE_LIMIT') {
          await deps.repository.finishRun(options.run.id, 'partial', 'PAGE_BUDGET_SPENT', now).catch(() => undefined)
          return { kind: 'partial', pagesStored, reason: 'PAGE_BUDGET_SPENT' }
        }
        const code = error instanceof MemberCollectionPageError ? error.code : 'MEMBER_COLLECTION_FAILURE'
        await deps.repository.finishRun(options.run.id, 'failed', code, now).catch(() => undefined)
        return { kind: 'failed', pagesStored, code }
      }
    },
  }
}
