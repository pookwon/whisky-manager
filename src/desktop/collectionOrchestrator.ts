import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../shared/cafeArticleList.js'
import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import type { Random } from '../shared/ports.js'
import type { CollectionFeed, CollectionFeedState, CollectionRepository, CreateCollectionRunInput } from './collection-db/repository.js'
import { locateResumePosition } from './collectionResume.js'
import type { ExtensionTransport } from './ws/server.js'

export interface CollectionClock { now(): number }
export interface BoardPageFetcher { read(page: number): Promise<CollectedArticlePage> }
export interface CollectionRunOptions { readonly feed: CollectionFeed; readonly run: CreateCollectionRunInput; readonly maxPages: number; readonly maxProbePages?: number }
export type CollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number; readonly requests: number }
  | { readonly kind: 'partial'; readonly pagesStored: number; readonly requests: number; readonly reason: 'PAGE_BUDGET_SPENT' | 'FEED_HORIZON' }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly requests: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number; readonly requests: number; readonly latestState: CollectionFeedState | null }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly requests: number; readonly code: string }

/**
 * The last page the cafe serves of any list. Asking beyond it answers with
 * page 1. Measured 2026-09-05 on the whole-cafe list and three boards.
 */
export const FEED_HORIZON_PAGE = 1000
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

export function createBoardPageFetcher(transport: ExtensionTransport, newRequestId: () => string, menuId: string): BoardPageFetcher {
  return { async read(page) {
    const message: Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' }> = { type: 'COLLECT_BOARD_PAGE', requestId: newRequestId(), cafeId: CAFE_ARTICLE_LIST.cafeId, menuId, page, pageSize: CAFE_ARTICLE_LIST.pageSize, sortBy: CAFE_ARTICLE_LIST.sortBy, viewType: CAFE_ARTICLE_LIST.viewType }
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
 * oldest post on the page — by looking.
 *
 * What is no longer guarded in flight is settled by looking at the stored
 * article ids afterwards: they are dense and rise with time, so a deleted post
 * leaves a gap of one or two and a lost page leaves one of fifty. That check is
 * run by hand against the database today; it is not in this repository.
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
    let reader: ScheduledReader | null = null
    try {
      if (options.run.feedKind !== options.feed.feedKind || options.run.menuId !== options.feed.menuId) throw new CollectionPageError('RUN_FEED_MISMATCH')
      const initial = await deps.repository.startRun(options.run)
      reader = createScheduledReader(deps, options.run.id, options.maxPages, options.maxProbePages ?? 64)
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
        return { kind: 'succeeded', pagesStored, requests: reader.reads }
      }
      // The cursor is real and the feed no longer serves the page it points
      // at. Finding the period afresh from its top would re-read everything
      // this job already holds; ending here leaves the reason on the run.
      if (resumed?.kind === 'unusable') throw new CollectionPageError('RESUME_POSITION_LOST')
      if (resumed?.kind === 'found') { pageNumber = resumed.page; firstOffset = resumed.offset; firstPage = resumed.candidate }
      else { const searched = await findCollectionStartPage(reader, options.run.targetEndMs); pageNumber = searched.page }
      let continuity: ContinuityAnchor | null = null
      while (true) {
        let page = firstPage ?? await reader.collect(pageNumber); firstPage = null
        if (fallback(page, pageNumber)) {
          // Asked for a page the feed does not have. Once the walk is under way
          // that is simply its end: the cafe answers from its newest page, and
          // there is nothing older left to read. It matters because the walk now
          // ends on a page's newest post, so it always asks for one page beyond
          // the last that held anything — and a period reaching back to the
          // cafe's own beginning would otherwise fail on every run forever.
          //
          // Only once under way. The same answer on the first page of a run
          // means the resume landed somewhere the feed cannot serve, which is a
          // fault and not an ending.
          if (continuity === null) throw new CollectionPageError('BOARD_PAGE_SILENT_FALLBACK')
          // Under way, a page the feed does not have is the end of the feed.
          // Which end matters: below the cafe's last servable page there may
          // be more, and calling that the period's end would mark a job done
          // that is not.
          if (continuity.page >= FEED_HORIZON_PAGE) {
            await deps.repository.markHorizonReached(options.feed, new Date(deps.clock.now()))
            await deps.repository.finishRun(options.run.id, 'partial', 'FEED_HORIZON', new Date(deps.clock.now()))
            return { kind: 'partial', pagesStored, requests: reader.reads, reason: 'FEED_HORIZON' }
          }
          await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now()))
          return { kind: 'succeeded', pagesStored, requests: reader.reads }
        }
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
          if (stored.kind === 'conflict') { const latestState = await deps.repository.readFeedState(options.feed); await deps.repository.finishRun(options.run.id, 'partial', 'CAS_CONFLICT_REPOSITION_REQUIRED', new Date(deps.clock.now())); return { kind: 'cas_conflict', pagesStored, requests: reader.reads, latestState } }
          const committed = oldestInRange
          state = {
            stateVersion: stored.nextStateVersion,
            anchorPostId: stored.anchorPostId,
            // A page just landed, so the walk is by definition not finished.
            complete: false,
            forced: state.forced,
            horizonReached: state.horizonReached,
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
        if (newestPostedAt(page) < options.run.targetStartMs) { await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now())); return { kind: 'succeeded', pagesStored, requests: reader.reads } }
        continuity = { page: pageNumber, postId: tail.postId, postedAtMs: tail.postedAt, pageIdentity: page.pageIdentity }
        pageNumber += 1
      }
    } catch (error) {
      if (error instanceof CollectionPageError && error.code === 'ABORTED') { await deps.repository.finishRun(options.run.id, 'interrupted', 'ABORTED', new Date(deps.clock.now())).catch(() => undefined); return { kind: 'interrupted', pagesStored, requests: reader?.reads ?? 0, reason: 'ABORTED' } }
      if (error instanceof CollectionPageError && error.code === 'MAX_PAGE_LIMIT') { await deps.repository.finishRun(options.run.id, 'partial', 'PAGE_BUDGET_SPENT', new Date(deps.clock.now())).catch(() => undefined); return { kind: 'partial', pagesStored, requests: reader?.reads ?? 0, reason: 'PAGE_BUDGET_SPENT' } }
      const code = error instanceof CollectionPageError ? error.code : 'COLLECTION_FAILURE'
      // The stop reason carries the detail so the run list itself explains the
      // failure; the returned code stays bare for callers that match on it.
      const stopReason = error instanceof CollectionPageError && error.detail !== undefined ? `${code}: ${error.detail}` : code
      await deps.repository.finishRun(options.run.id, 'failed', stopReason, new Date(deps.clock.now())).catch(() => undefined); return { kind: 'failed', pagesStored, requests: reader?.reads ?? 0, code }
    }
  } }
}
