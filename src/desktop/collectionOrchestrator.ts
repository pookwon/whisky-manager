import { TIMEOUTS, type AppMessage } from '../shared/protocol.js'
import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import type { Random } from '../shared/ports.js'
import type { CollectionFeed, CollectionFeedState, CollectionRepository, CreateCollectionRunInput } from './collection-db/repository.js'
import type { ExtensionTransport } from './ws/server.js'

export interface CollectionClock { now(): number }
export interface BoardPageFetcher { read(page: number): Promise<CollectedArticlePage> }
export interface CollectionRunOptions { readonly feed: CollectionFeed; readonly run: CreateCollectionRunInput; readonly parserVersion: string; readonly maxPages: number; readonly maxProbePages?: number }
export type CollectionRunResult =
  | { readonly kind: 'succeeded'; readonly pagesStored: number }
  | { readonly kind: 'interrupted'; readonly pagesStored: number; readonly reason: 'ABORTED' }
  | { readonly kind: 'cas_conflict'; readonly pagesStored: number; readonly latestState: CollectionFeedState | null }
  | { readonly kind: 'failed'; readonly pagesStored: number; readonly code: string }
export interface CollectionOrchestratorDeps { readonly repository: CollectionRepository; readonly fetcher: BoardPageFetcher; readonly clock: CollectionClock; readonly random: Random; readonly sleep: (ms: number) => Promise<void>; readonly isSessionBusy: () => boolean; readonly isAbortRequested: () => boolean; readonly onYieldToSession?: () => void }
export class CollectionPageError extends Error { constructor(readonly code: string) { super(code); this.name = 'CollectionPageError' } }

export function createBoardPageFetcher(transport: ExtensionTransport, newRequestId: () => string): BoardPageFetcher {
  return { async read(page) {
    const message: Extract<AppMessage, { type: 'COLLECT_BOARD_PAGE' }> = { type: 'COLLECT_BOARD_PAGE', requestId: newRequestId(), cafeId: '14538121', menuId: '0', page, pageSize: 50, sortBy: 'TIME', viewType: 'L' }
    const reply = await transport.request(message, TIMEOUTS.boardPageMs)
    if (reply.type === 'BOARD_PAGE_COLLECTED') return reply.result
    if (reply.type === 'ERROR') throw new CollectionPageError(reply.code)
    throw new CollectionPageError('BOARD_PAGE_UNEXPECTED_REPLY')
  } }
}

function assertPage(page: CollectedArticlePage): void {
  if (page.items.length === 0) throw new CollectionPageError('BOARD_PAGE_EMPTY')
  const ids = new Set<string>(); let previous = Number.POSITIVE_INFINITY
  for (const item of page.items) { if (ids.has(item.postId)) throw new CollectionPageError('BOARD_PAGE_DUPLICATE_POST'); if (item.postedAt > previous) throw new CollectionPageError('BOARD_PAGE_TIMESTAMP_ORDER'); ids.add(item.postId); previous = item.postedAt }
}
function oldest(page: CollectedArticlePage): number { const item = page.items.at(-1); if (item === undefined) throw new CollectionPageError('BOARD_PAGE_EMPTY'); return item.postedAt }
function fallback(page: CollectedArticlePage, requested: number): boolean { return requested > page.pageInfo.lastNavigationPageNumber }

/** Delay before request ordinal N. The first request has no delay or modulo break. */
export function collectionDelayMs(requestOrdinal: number, random: Random): number {
  if (requestOrdinal <= 1) return 0
  let delay = random.intInclusive(5_000, 9_000)
  if (requestOrdinal % 20 === 0) delay += random.intInclusive(120_000, 300_000)
  if (requestOrdinal % 100 === 0) delay += random.intInclusive(600_000, 1_200_000)
  return delay
}

export interface ScheduledReader { probe(page: number): Promise<CollectedArticlePage>; collect(page: number): Promise<CollectedArticlePage>; readonly reads: number }
function createScheduledReader(deps: CollectionOrchestratorDeps, runId: string, maxPages: number, maxProbePages: number): ScheduledReader {
  let reads = 0; let probes = 0
  const read = async (page: number, phase: 'probe' | 'collection'): Promise<CollectedArticlePage> => {
    if (reads >= maxPages) throw new CollectionPageError('MAX_PAGE_LIMIT')
    if (phase === 'probe' && probes >= maxProbePages) throw new CollectionPageError('PROBE_PAGE_LIMIT')
    while (deps.isSessionBusy()) { if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED'); deps.onYieldToSession?.(); await deps.sleep(1_000) }
    if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED')
    const delay = collectionDelayMs(reads + 1, deps.random); if (delay > 0) await deps.sleep(delay)
    while (deps.isSessionBusy()) { if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED'); deps.onYieldToSession?.(); await deps.sleep(1_000) }
    if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED')
    await deps.repository.recordPageRequest(runId, phase); reads += 1; if (phase === 'probe') probes += 1
    const value = await deps.fetcher.read(page); assertPage(value); return value
  }
  return { probe: (page) => read(page, 'probe'), collect: (page) => read(page, 'collection'), get reads() { return reads } }
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

async function locateAnchor(reader: ScheduledReader, state: Pick<CollectionFeedState, 'anchorPostId' | 'referencePage'>, targetStartMs: number): Promise<{ page: number; offset: number; candidate: CollectedArticlePage } | null> {
  if (state.anchorPostId === null) return null
  let page = Math.max(1, (state.referencePage ?? 1) - 1)
  for (let scanned = 0; scanned < 24; scanned += 1, page += 1) {
    const candidate = await reader.collect(page)
    if (fallback(candidate, page)) return null
    const index = candidate.items.findIndex((item) => item.postId === state.anchorPostId)
    if (index >= 0) return { page, offset: index + 1, candidate }
    if (oldest(candidate) < targetStartMs) return null
  }
  return null
}

interface ContinuityAnchor { readonly page: number; readonly postId: string; readonly pageIdentity: string; readonly totalArticleCount: number }

/**
 * Stable adjacent pages share no post IDs, so overlap with the previous page
 * cannot be the continuity invariant. An unchanged feed-wide article count
 * means nothing was inserted or deleted since the previous read, so the next
 * page is contiguous without a rewind; additions and deletions that exactly
 * cancel within one inter-page interval escape this shortcut. When the count
 * changed and the previous tail does not surface in the next page, only a
 * rewind read of the previous page can distinguish harmless movement from
 * posts pulled up past the boundary by deletions.
 */
async function verifyContinuity(reader: ScheduledReader, previous: ContinuityAnchor, next: CollectedArticlePage, nextPageNumber: number, targetStartMs: number): Promise<{ page: CollectedArticlePage; pageNumber: number; firstOffset: number }> {
  const surfaced = next.items.findIndex((item) => item.postId === previous.postId)
  if (surfaced >= 0) return { page: next, pageNumber: nextPageNumber, firstOffset: surfaced + 1 }
  if (next.pageInfo.totalArticleCount === previous.totalArticleCount) return { page: next, pageNumber: nextPageNumber, firstOffset: 0 }
  const rewind = await reader.collect(previous.page)
  if (fallback(rewind, previous.page)) throw new CollectionPageError('BOARD_PAGE_SILENT_FALLBACK')
  if (rewind.pageIdentity === previous.pageIdentity) return { page: next, pageNumber: nextPageNumber, firstOffset: 0 }
  const index = rewind.items.findIndex((item) => item.postId === previous.postId)
  if (index === rewind.items.length - 1) return { page: next, pageNumber: nextPageNumber, firstOffset: 0 }
  if (index >= 0) return { page: rewind, pageNumber: previous.page, firstOffset: index + 1 }
  const relocated = await locateAnchor(reader, { anchorPostId: previous.postId, referencePage: previous.page }, targetStartMs)
  if (relocated === null) throw new CollectionPageError('ANCHOR_RELOCATION_FAILED')
  return { page: relocated.candidate, pageNumber: relocated.page, firstOffset: relocated.offset }
}

export function createCollectionOrchestrator(deps: CollectionOrchestratorDeps) {
  return { async run(options: CollectionRunOptions): Promise<CollectionRunResult> {
    let pagesStored = 0
    try {
      if (options.run.cafeId !== options.feed.cafeId || options.run.feedKind !== options.feed.feedKind || options.run.menuId !== options.feed.menuId) throw new CollectionPageError('RUN_FEED_MISMATCH')
      const initial = await deps.repository.startRun(options.run)
      const reader = createScheduledReader(deps, options.run.id, options.maxPages, options.maxProbePages ?? 64)
      let state: CollectionFeedState = initial
      let pageNumber: number; let firstOffset = 0; let firstPage: CollectedArticlePage | null = null
      const located = await locateAnchor(reader, state, options.run.targetStartMs)
      if (located !== null) { pageNumber = located.page; firstOffset = located.offset; firstPage = located.candidate }
      else { const searched = await findCollectionStartPage(reader, options.run.targetEndMs); pageNumber = searched.page }
      let continuity: ContinuityAnchor | null = null
      while (true) {
        let page = firstPage ?? await reader.collect(pageNumber); firstPage = null
        if (fallback(page, pageNumber)) throw new CollectionPageError('BOARD_PAGE_SILENT_FALLBACK')
        if (continuity !== null) {
          const verified = await verifyContinuity(reader, continuity, page, pageNumber, options.run.targetStartMs)
          page = verified.page; pageNumber = verified.pageNumber; firstOffset = verified.firstOffset
          if (page.pageIdentity === continuity.pageIdentity) throw new CollectionPageError('BOARD_PAGE_REPEATED')
        }
        if (deps.isAbortRequested()) throw new CollectionPageError('ABORTED')
        const inRange = page.items.slice(firstOffset).filter((item) => item.postedAt >= options.run.targetStartMs && item.postedAt < options.run.targetEndMs); firstOffset = 0
        if (inRange.length > 0) {
          const stored = await deps.repository.persistPage({ feed: options.feed, runId: options.run.id, observedAt: new Date(deps.clock.now()), referencePage: pageNumber, expectedState: state, page: { ...page, items: inRange }, parserVersion: options.parserVersion })
          if (stored.kind === 'conflict') { const latestState = await deps.repository.readFeedState(options.feed); await deps.repository.finishRun(options.run.id, 'partial', 'CAS_CONFLICT_REPOSITION_REQUIRED', new Date(deps.clock.now())); return { kind: 'cas_conflict', pagesStored, latestState } }
          state = { stateVersion: stored.nextStateVersion, anchorPostId: stored.anchorPostId, referencePage: pageNumber, pageIdentity: page.pageIdentity, anchorPostedDateKst: null, targetStartMs: options.run.targetStartMs, targetEndMs: options.run.targetEndMs }; pagesStored += 1
        }
        const tail = page.items.at(-1)
        if (tail === undefined) throw new CollectionPageError('BOARD_PAGE_EMPTY')
        if (tail.postedAt < options.run.targetStartMs) { await deps.repository.finishRun(options.run.id, 'succeeded', null, new Date(deps.clock.now())); return { kind: 'succeeded', pagesStored } }
        continuity = { page: pageNumber, postId: tail.postId, pageIdentity: page.pageIdentity, totalArticleCount: page.pageInfo.totalArticleCount }
        pageNumber += 1
      }
    } catch (error) {
      if (error instanceof CollectionPageError && error.code === 'ABORTED') { await deps.repository.finishRun(options.run.id, 'interrupted', 'ABORTED', new Date(deps.clock.now())).catch(() => undefined); return { kind: 'interrupted', pagesStored, reason: 'ABORTED' } }
      const code = error instanceof CollectionPageError ? error.code : 'COLLECTION_FAILURE'; await deps.repository.finishRun(options.run.id, 'failed', code, new Date(deps.clock.now())).catch(() => undefined); return { kind: 'failed', pagesStored, code }
    }
  } }
}
