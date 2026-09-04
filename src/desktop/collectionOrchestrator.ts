import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../shared/cafeArticleList.js'
import type { Random } from '../shared/ports.js'
import type { CollectionFeed, CollectionFeedState, CollectionRepository, CreateCollectionRunInput } from './collection-db/repository.js'
import { locateResumePosition } from './collectionResume.js'
import type { ExtensionTransport } from './ws/server.js'

export interface CollectionClock { now(): number }
export interface BoardPageFetcher { read(page: number): Promise<CollectedArticlePage> }
export interface CollectionRunOptions { readonly feed: CollectionFeed; readonly run: CreateCollectionRunInput; readonly maxPages: number; readonly maxProbePages?: number }
export type CollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number }
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly reason: 'PAGE_BUDGET_SPENT' }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number; readonly latestState: CollectionFeedState | null }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly code: string }
export interface CollectionOrchestratorDeps { readonly repository: CollectionRepository; readonly fetcher: BoardPageFetcher; readonly clock: CollectionClock; readonly random: Random; readonly sleep: (ms: number) => Promise<void>; readonly isSessionBusy: () => boolean; readonly isAbortRequested: () => boolean; readonly onYieldToSession?: () => void }
/**
 * `code` is the stable name a screen and a query can match on. `detail` is what
 * a person needs to see when the code alone does not say what to do — it is
 * carried into the run's stop reason, so the answer sits in the app's own run
 * list rather than in a log file nobody opens. It must never carry post titles
 * or response bodies: identifiers and times only.
 */
export class CollectionPageError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail === undefined ? code : `${code}: ${detail}`)
    this.name = 'CollectionPageError'
  }
}

export function createBoardPageFetcher(transport: ExtensionTransport, newRequestId: () => string): BoardPageFetcher {
  return { async read(page) {
    const message: Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' }> = { type: 'COLLECT_BOARD_PAGE', requestId: newRequestId(), cafeId: '14538121', menuId: '0', page, pageSize: 50, sortBy: 'TIME', viewType: 'L' }
    const reply = await transport.request(message, TIMEOUTS.boardPageMs)
    if (reply.type === 'BOARD_PAGE_COLLECTED') return reply.result
    if (reply.type === 'ERROR') throw new CollectionPageError(reply.code)
    throw new CollectionPageError('BOARD_PAGE_UNEXPECTED_REPLY')
  } }
}

/**
 * What a page has to be for the walk to use it at all.
 *
 * Order is deliberately not among it. Page 834 of this cafe returns fifty posts
 * sampled across hundreds of article ids and many hours, in dozens of
 * descending runs, and comes back a different shape on every read — sometimes
 * ending on its oldest post, sometimes not. A plain read of the same url
 * reproduces it, so it is the cafe's answer. Every rule this walk tried to hold
 * the order to was broken by the next read, and refusing cost days of standing
 * still while losing nothing: the posts are all real and agree on time when
 * sorted by article id.
 *
 * So nothing below reads a post's position. The walk takes what it needs — the
 * oldest post on the page — by looking, and completeness is settled afterwards
 * by the article-id audit, which tells a deleted post (a gap of one or two)
 * from a lost page (a gap of fifty).
 */
function assertPage(page: CollectedArticlePage, requested: number): void {
  if (page.items.length === 0) throw new CollectionPageError('BOARD_PAGE_EMPTY')
  const ids = new Set<string>()
  for (const [index, item] of page.items.entries()) {
    if (ids.has(item.postId)) throw new CollectionPageError('BOARD_PAGE_DUPLICATE_POST', `page ${requested} #${index} ${item.postId}`)
    ids.add(item.postId)
  }
}

/** The oldest post on a page, wherever it happens to sit in it. */
function oldestPost(page: CollectedArticlePage): CollectedPostMetadata {
  let found = page.items[0]
  if (found === undefined) throw new CollectionPageError('BOARD_PAGE_EMPTY')
  for (const item of page.items) if (item.postedAt < found.postedAt) found = item
  return found
}

/** The newest post's time, which is what says the walk has passed the period. */
function newestPostedAt(page: CollectedArticlePage): number {
  if (page.items.length === 0) throw new CollectionPageError('BOARD_PAGE_EMPTY')
  return Math.max(...page.items.map((item) => item.postedAt))
}

function oldest(page: CollectedArticlePage): number { return oldestPost(page).postedAt }
function fallback(page: CollectedArticlePage, requested: number): boolean { return requested > page.pageInfo.lastNavigationPageNumber }

/** Delay before request ordinal N. The first request has no delay or modulo break. */
export function collectionDelayMs(requestOrdinal: number, random: Random): number {
  if (requestOrdinal <= 1) return 0
  let delay = random.intInclusive(5_000, 9_000)
  if (requestOrdinal % 20 === 0) delay += random.intInclusive(120_000, 300_000)
  if (requestOrdinal % 100 === 0) delay += random.intInclusive(600_000, 1_200_000)
  return delay
}

export interface ScheduledReader {
  probe(page: number): Promise<CollectedArticlePage>
  collect(page: number): Promise<CollectedArticlePage>
  observedAt(page: CollectedArticlePage): Date
  readonly reads: number
}
function createScheduledReader(deps: CollectionOrchestratorDeps, runId: string, maxPages: number, maxProbePages: number): ScheduledReader {
  let reads = 0; let probes = 0
  const observations = new WeakMap<CollectedArticlePage, Date>()
  const read = async (page: number, phase: 'probe' | 'collection'): Promise<CollectedArticlePage> => {
    if (reads >= maxPages) throw new CollectionPageError('MAX_PAGE_LIMIT')
    if (phase === 'probe' && probes >= maxProbePages) throw new CollectionPageError('PROBE_PAGE_LIMIT')
    while (deps.isSessionBusy()) { if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED'); deps.onYieldToSession?.(); await deps.sleep(1_000) }
    if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED')
    const delay = collectionDelayMs(reads + 1, deps.random); if (delay > 0) await deps.sleep(delay)
    while (deps.isSessionBusy()) { if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED'); deps.onYieldToSession?.(); await deps.sleep(1_000) }
    if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED')
    await deps.repository.recordPageRequest(runId, phase); reads += 1; if (phase === 'probe') probes += 1
    // The observation belongs to the network read, not to however much
    // continuity checking or PostgreSQL work happens after its response.
    const observedAt = new Date(deps.clock.now())
    const value = await deps.fetcher.read(page); assertPage(value, page)
    observations.set(value, observedAt)
    return value
  }
  return {
    probe: (page) => read(page, 'probe'),
    collect: (page) => read(page, 'collection'),
    observedAt(page) {
      const value = observations.get(page)
      if (value === undefined) throw new CollectionPageError('BOARD_PAGE_OBSERVATION_TIME_MISSING')
      return value
    },
    get reads() { return reads },
  }
}

/** Uses only scheduler reads; silent fallback is an invalid upper bound. */
export async function findCollectionStartPage(reader: ScheduledReader, targetEndMs: number): Promise<{ baseline: CollectedArticlePage; page: number }> {
  const baseline = await reader.probe(1)
  if (oldest(baseline) < targetEndMs) return { baseline, page: 1 }
  let lower = 1; let upper = 2; let crossed = false
  while (true) {
    const candidate = await reader.probe(upper)
    if (fallback(candidate, upper)) break
    if (oldest(candidate) < targetEndMs) { crossed = true; break }
    lower = upper; upper *= 2
    if (!Number.isSafeInteger(upper)) throw new CollectionPageError('TARGET_PAGE_UNAVAILABLE')
  }
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2); const candidate = await reader.probe(middle)
    if (fallback(candidate, middle) || oldest(candidate) < targetEndMs) { upper = middle; if (!fallback(candidate, middle)) crossed = true } else lower = middle
  }
  if (!crossed) throw new CollectionPageError('TARGET_PAGE_UNAVAILABLE')
  return { baseline, page: upper }
}

interface ContinuityAnchor { readonly page: number; readonly postId: string; readonly postedAtMs: number; readonly pageIdentity: string }

/**
 * Stable adjacent pages share no post IDs, so overlap with the previous page
 * cannot be the continuity invariant. When the previous tail does not surface
 * in the next page, a rewind is mandatory: insertions and deletions can cancel
 * out while still moving the boundary, so totalArticleCount is not evidence of
 * continuity.
 */
async function verifyContinuity(reader: ScheduledReader, previous: ContinuityAnchor, next: CollectedArticlePage, nextPageNumber: number, targetStartMs: number, nowMs: number): Promise<{ page: CollectedArticlePage; pageNumber: number; firstOffset: number }> {
  const surfaced = next.items.findIndex((item) => item.postId === previous.postId)
  if (surfaced >= 0) return { page: next, pageNumber: nextPageNumber, firstOffset: surfaced + 1 }
  const rewind = await reader.collect(previous.page)
  if (fallback(rewind, previous.page)) throw new CollectionPageError('BOARD_PAGE_SILENT_FALLBACK')
  if (rewind.pageIdentity === previous.pageIdentity) return { page: next, pageNumber: nextPageNumber, firstOffset: 0 }
  const index = rewind.items.findIndex((item) => item.postId === previous.postId)
  if (index === rewind.items.length - 1) return { page: next, pageNumber: nextPageNumber, firstOffset: 0 }
  if (index >= 0) return { page: rewind, pageNumber: previous.page, firstOffset: index + 1 }
  // Seconds old, so this always takes the page-by-page path.
  const relocated = await locateResumePosition(
    reader,
    { anchorPostId: previous.postId, anchorPostedAtMs: previous.postedAtMs, referencePage: previous.page, cursorUpdatedAtMs: nowMs },
    nowMs,
    targetStartMs,
  )
  if (relocated.kind !== 'found') throw new CollectionPageError('ANCHOR_RELOCATION_FAILED')
  return { page: relocated.candidate, pageNumber: relocated.page, firstOffset: relocated.offset }
}

export function createCollectionOrchestrator(deps: CollectionOrchestratorDeps) {
  return { async run(options: CollectionRunOptions): Promise<CollectionRunResult> {
    let pagesStored = 0
    try {
      if (options.run.feedKind !== options.feed.feedKind || options.run.menuId !== options.feed.menuId) throw new CollectionPageError('RUN_FEED_MISMATCH')
      const initial = await deps.repository.startRun(options.run)
      const reader = createScheduledReader(deps, options.run.id, options.maxPages, options.maxProbePages ?? 64)
      let state: CollectionFeedState = initial
      let pageNumber: number; let firstOffset = 0; let firstPage: CollectedArticlePage | null = null
      const resumed = state.anchorPostId !== null && state.anchorPostedAtMs !== null && state.referencePage !== null
        ? await locateResumePosition(
            reader,
            {
              anchorPostId: state.anchorPostId,
              anchorPostedAtMs: state.anchorPostedAtMs,
              referencePage: state.referencePage,
              cursorUpdatedAtMs: state.cursorUpdatedAtMs,
            },
            deps.clock.now(),
            options.run.targetStartMs,
          )
        : null
      if (resumed?.kind === 'complete') {
        await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
        return { kind: 'succeeded', pagesStored }
      }
      if (resumed?.kind === 'found') { pageNumber = resumed.page; firstOffset = resumed.offset; firstPage = resumed.candidate }
      else { const searched = await findCollectionStartPage(reader, options.run.targetEndMs); pageNumber = searched.page }
      let continuity: ContinuityAnchor | null = null
      while (true) {
        let page = firstPage ?? await reader.collect(pageNumber); firstPage = null
        if (fallback(page, pageNumber)) throw new CollectionPageError('BOARD_PAGE_SILENT_FALLBACK')
        if (continuity !== null) {
          const verified = await verifyContinuity(reader, continuity, page, pageNumber, options.run.targetStartMs, deps.clock.now())
          page = verified.page; pageNumber = verified.pageNumber; firstOffset = verified.firstOffset
          if (page.pageIdentity === continuity.pageIdentity) throw new CollectionPageError('BOARD_PAGE_REPEATED')
        }
        if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED')
        const inRange = page.items.slice(firstOffset).filter((item) => item.postedAt >= options.run.targetStartMs && item.postedAt < options.run.targetEndMs); firstOffset = 0
        if (inRange.length > 0) {
          // Sorted for the write only. The repository takes the last row as the
          // anchor, and that has to be the oldest post committed or the next run
          // resumes from somewhere it has already been. The page itself is left
          // in the order the feed gave, because the positions a resume counts
          // are positions in that.
          const ordered = [...inRange].sort((left, right) => right.postedAt - left.postedAt)
          const oldestInRange = ordered.at(-1)
          const stored = await deps.repository.persistPage({ feed: options.feed, runId: options.run.id, observedAt: reader.observedAt(page), referencePage: pageNumber, expectedState: state, page: { ...page, items: ordered } })
          // Not retried here: a conflict means the stored cursor moved under
          // this walk, so the page number it is holding no longer addresses
          // what it thinks. Ending lets the next run find its place again from
          // the cursor rather than writing from a position already known stale.
          if (stored.kind === 'conflict') { const latestState = await deps.repository.readFeedState(options.feed); await deps.repository.finishRun(options.run.id, 'partial', 'CAS_CONFLICT_REPOSITION_REQUIRED', new Date(deps.clock.now())); return { kind: 'cas_conflict', pagesStored, latestState } }
          const committed = oldestInRange
          state = {
            stateVersion: stored.nextStateVersion,
            anchorPostId: stored.anchorPostId,
            // A page just landed, so the walk is by definition not finished.
            complete: false,
            forced: state.forced,
            referencePage: pageNumber,
            pageIdentity: page.pageIdentity,
            anchorPostedAtMs: committed?.postedAt ?? null,
            cursorUpdatedAtMs: deps.clock.now(),
            targetStartMs: options.run.targetStartMs,
            targetEndMs: options.run.targetEndMs,
          }
          pagesStored += 1
        }
        // The whole page rather than what was stored from it: everything stored
        // is inside the period by construction, so its oldest could never fall
        // below the period's start and the walk would only ever end by spending
        // its page budget.
        //
        // And the newest post on the page, not the oldest: one post carrying a
        // far older time — restored, or the list simply not in the order it
        // looks — would otherwise end the walk at a boundary it never reached,
        // leaving everything below uncollected while the run reported success.
        // Waiting for the whole page to fall below costs one more page.
        const tail = oldestPost(page)
        if (newestPostedAt(page) < options.run.targetStartMs) { await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now())); return { kind: 'succeeded', pagesStored } }
        continuity = { page: pageNumber, postId: tail.postId, postedAtMs: tail.postedAt, pageIdentity: page.pageIdentity }
        pageNumber += 1
      }
    } catch (error) {
      if (error instanceof CollectionPageError && error.code === 'ABORTED') { await deps.repository.finishRun(options.run.id, 'interrupted', 'ABORTED', new Date(deps.clock.now())).catch(() => undefined); return { kind: 'interrupted', pagesStored, reason: 'ABORTED' } }
      if (error instanceof CollectionPageError && error.code === 'MAX_PAGE_LIMIT') { await deps.repository.finishRun(options.run.id, 'partial', 'PAGE_BUDGET_SPENT', new Date(deps.clock.now())).catch(() => undefined); return { kind: 'partial', pagesStored, reason: 'PAGE_BUDGET_SPENT' } }
      const code = error instanceof CollectionPageError ? error.code : 'COLLECTION_FAILURE'
      // The stop reason carries the detail so the run list itself explains the
      // failure; the returned code stays bare for callers that match on it.
      const stopReason = error instanceof CollectionPageError && error.detail !== undefined ? `${code}: ${error.detail}` : code
      await deps.repository.finishRun(options.run.id, 'failed', stopReason, new Date(deps.clock.now())).catch(() => undefined); return { kind: 'failed', pagesStored, code }
    }
  } }
}
