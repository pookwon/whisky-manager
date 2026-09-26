import type { CollectionPacing } from '../shared/collectionPacing.js'
import { collectionDelayMs } from '../shared/collectionPacing.js'
import { BOARD_SEARCH_CAP_PAGE, CAFE_BOARD_SEARCH } from '../shared/cafeBoardSearchEndpoint.js'
import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { kstDayKey, kstDayKeyRange, MS_PER_DAY } from '../shared/kst.js'
import type { Random } from '../shared/ports.js'
import type { BoardSearchQueryState, BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from './boardSearchPageFetcher.js'
import { assertBoardSearchPage, assertBoardSearchPageFollows } from './boardSearchPageCheck.js'
import type { CollectionLock } from './collectionLock.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import { CollectionPageError } from './collectionPageError.js'
import { pauseUnlessStopped } from './collectionPause.js'
import type { CollectionStartResult } from './collectionRunner.js'
import { failedRunStopReason } from './failedRunStopReason.js'

export interface BoardSearchRunnerDeps {
  readonly repository: () => BoardSearchRepository | null
  readonly fetcher: BoardSearchPageFetcher
  readonly isConnected: () => boolean
  readonly clock: CollectionClock
  readonly random: Random
  /** Read once per block, like the list walk's: the budget came from the same pacing. */
  readonly pacing: () => CollectionPacing
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  /** The same lock the list and member walks take: one browser session, one walk. */
  readonly lock: CollectionLock
  readonly newId: () => string
  readonly onError?: (error: unknown) => void
}

export interface BoardSearchRunner {
  start(request: { readonly maxPages: number }): CollectionStartResult
  stop(): void
  isRunning(): boolean
}

/**
 * The failures that belong to one query's results. Anything else — a refused
 * or unreadable request — would meet every query after it the same way, and
 * going on would only spend the budget one failed run at a time.
 */
const QUERY_OWN_FAILURES: ReadonlySet<string> = new Set(['BOARD_SEARCH_WRONG_BOARD', 'BOARD_SEARCH_OUT_OF_WINDOW', 'BOARD_PAGE_DUPLICATE_POST'])

type QueryOutcome = { readonly requests: number; readonly endsBlock: boolean }

/** What a page says about the window the query walks. */
type SegmentStep =
  | { readonly kind: 'next_page' }
  /** `steppedBack`: the new end is a day before the post narrowed from, so no post on it has been seen. */
  | { readonly kind: 'narrow'; readonly segmentToDay: string; readonly steppedBack: boolean }
  | { readonly kind: 'complete' }

/** The page read last in this window in this run: what an empty page after it means. */
type PreviousPage = { readonly oldestPostedAt: number; readonly isFull: boolean }

type SegmentWindow = { readonly fromDay: string; readonly toDay: string }

function oldestPostedAt(result: CollectedArticlePage): number {
  return Math.min(...result.items.map((item) => item.postedAt))
}

function isFullPage(result: CollectedArticlePage): boolean {
  return result.items.length === CAFE_BOARD_SEARCH.perPage
}

/**
 * Where the search cut the window's results off, the rest is older than the
 * last post it served, so the walk goes on in a window ending on that post's
 * day, overlapping it. When that day already ends the window, one day holds
 * more than the cap: the walk steps a day earlier and the rest of that day is
 * not reached.
 */
function segmentStepBefore(oldestMs: number, window: SegmentWindow): SegmentStep {
  const oldestDay = kstDayKey(oldestMs)
  const steppedBack = oldestDay === window.toDay
  const segmentToDay = steppedBack ? kstDayKey(kstDayKeyRange(oldestDay).startMs - MS_PER_DAY) : oldestDay
  return segmentToDay < window.fromDay ? { kind: 'complete' } : { kind: 'narrow', segmentToDay, steppedBack }
}

/** A full cap page means the search cut the results off there, not that they ended. */
function segmentStepAfter(page: number, result: CollectedArticlePage, window: SegmentWindow): SegmentStep {
  if (page !== BOARD_SEARCH_CAP_PAGE || !isFullPage(result)) return { kind: 'next_page' }
  return segmentStepBefore(oldestPostedAt(result), window)
}

/**
 * An empty page ends the results, unless it is the one the search serves once
 * it stops serving a window — its pageInfo all zeros — right after a full page:
 * then the cap was reached there, whatever the page number. With no page read
 * before it in this run, there is nothing to narrow from and no telling whether
 * the results ended; only a first page, with nothing before it, is plainly the
 * end.
 */
function segmentStepAtEmptyPage(page: number, result: CollectedArticlePage, previous: PreviousPage | null, window: SegmentWindow): SegmentStep {
  if (result.pageInfo.lastNavigationPageNumber !== 0) return { kind: 'complete' }
  if (previous === null) {
    if (page === 1) return { kind: 'complete' }
    throw new CollectionPageError('BOARD_SEARCH_CAP_UNCLEAR', `page ${page}`)
  }
  return previous.isFull ? segmentStepBefore(previous.oldestPostedAt, window) : { kind: 'complete' }
}

export function createBoardSearchRunner(deps: BoardSearchRunnerDeps): BoardSearchRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false

  async function waitForTurn(ordinal: number, pacing: CollectionPacing): Promise<void> {
    const yieldToSession = async () => {
      while (deps.isSessionBusy()) {
        if (abortRequested) throw new CollectionPageError('ABORTED')
        await deps.sleep(1_000)
      }
    }
    await yieldToSession()
    if (!(await pauseUnlessStopped(collectionDelayMs(ordinal, pacing, deps.random), deps.sleep, () => abortRequested))) {
      throw new CollectionPageError('ABORTED')
    }
    await yieldToSession()
    if (abortRequested) throw new CollectionPageError('ABORTED')
  }

  /**
   * One query, from its cursor to its empty page or the end of the budget. A
   * resumed query reads its last stored page again: a post deleted from the
   * window since then pulls the results forward, and the re-read picks up the
   * one that slid onto it. The request window is the query's segment; a
   * narrower one goes on in the same run from its first page.
   */
  async function walkQuery(repository: BoardSearchRepository, query: BoardSearchQueryState, budget: number, spentBefore: number, pacing: CollectionPacing): Promise<QueryOutcome> {
    const runId = deps.newId()
    let requests = 0
    let pageNumber = query.lastCommittedPage ?? 1
    let window = { boardId: query.boardId, fromDay: query.fromDay, toDay: query.segmentToDay ?? query.toDay }
    let previousPage: PreviousPage | null = null
    /**
     * Whether page 1 of the window must hold posts: its end is a day the walk
     * has seen posts on. So after a narrowing onto the oldest post's day, and
     * on a resumed segment whose page 1 was stored before. A resumed segment
     * with no stored page may have been stepped back onto a day nothing was
     * seen on — nothing records which — so its empty page 1 is an end.
     */
    let firstPageHoldsPosts = query.segmentToDay !== null && query.lastCommittedPage === 1
    const now = () => new Date(deps.clock.now())
    try {
      await repository.startRun({ id: runId, boardId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, startedAt: now() })
      for (;;) {
        if (requests >= budget) {
          await repository.finishRun(runId, 'partial', 'PAGE_BUDGET_SPENT', now())
          return { requests, endsBlock: false }
        }
        await waitForTurn(spentBefore + requests + 1, pacing)
        await repository.recordPageRequest(runId)
        requests += 1
        const observedAt = new Date(deps.clock.now())
        const result = await deps.fetcher.read({ menuId: query.boardId, query: query.query, fromDay: window.fromDay, toDay: window.toDay, page: pageNumber })
        let step: SegmentStep
        if (result.items.length === 0) {
          if (firstPageHoldsPosts) {
            throw new CollectionPageError('BOARD_SEARCH_SEGMENT_EMPTY', `segment to ${window.toDay}`)
          }
          step = segmentStepAtEmptyPage(pageNumber, result, previousPage, window)
        } else {
          assertBoardSearchPage(result, window)
          if (previousPage !== null) assertBoardSearchPageFollows(result, previousPage.oldestPostedAt)
          await repository.persistPage({ runId, boardId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, page: pageNumber, observedAt, result })
          step = segmentStepAfter(pageNumber, result, window)
          previousPage = { oldestPostedAt: oldestPostedAt(result), isFull: isFullPage(result) }
          firstPageHoldsPosts = false
        }
        if (step.kind === 'complete') {
          await repository.finishRun(runId, 'succeeded', null, now())
          return { requests, endsBlock: false }
        }
        if (step.kind === 'narrow') {
          await repository.narrowSegment({ boardId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, segmentToDay: step.segmentToDay, at: now() })
          window = { ...window, toDay: step.segmentToDay }
          previousPage = null
          firstPageHoldsPosts = !step.steppedBack
          pageNumber = 1
          continue
        }
        pageNumber += 1
      }
    } catch (error) {
      // A run this write cannot close stays `running`, and the one running
      // search run a board may have blocks every later start until it is
      // swept. The walk goes on regardless; the failure is reported, since
      // nothing else would ever say why the row was left.
      const close = (status: 'failed' | 'interrupted', stopReason: string) =>
        repository.finishRun(runId, status, stopReason, now()).catch((closeError: unknown) => { deps.onError?.(closeError) })
      if (error instanceof CollectionPageError && error.code === 'ABORTED') {
        await close('interrupted', 'ABORTED')
        return { requests, endsBlock: true }
      }
      const failure = failedRunStopReason(error)
      await close('failed', failure.stopReason)
      return { requests, endsBlock: !QUERY_OWN_FAILURES.has(failure.code) }
    }
  }

  /**
   * A block over the queue: unused budget passes on and a query's own failure
   * moves on; a stop, or a failure every query would share, ends the block.
   * It first closes any search run an earlier block could not: the lock is
   * held, so none is being written, and a board's one running search run
   * would refuse every run this block starts.
   */
  async function walk(repository: BoardSearchRepository, maxPages: number): Promise<void> {
    await repository.reconcileOrphanedRuns(new Date(deps.clock.now()))
    const pacing = deps.pacing()
    let spent = 0
    for (const query of await repository.listQueries()) {
      if (query.complete) continue
      if (abortRequested || spent >= maxPages) break
      const outcome = await walkQuery(repository, query, maxPages - spent, spent, pacing)
      spent += outcome.requests
      if (outcome.endsBlock) break
    }
  }

  return {
    start(request) {
      if (inFlight !== null) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const repository = deps.repository()
      if (repository === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      if (!deps.isConnected()) return { kind: 'refused', reason: 'BRIDGE_OFFLINE' }
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      abortRequested = false
      inFlight = walk(repository, request.maxPages)
        .catch((error: unknown) => { deps.onError?.(error) })
        .finally(() => { inFlight = null; deps.lock.release() })
      return { kind: 'started' }
    },
    stop() {
      abortRequested = true
    },
    isRunning() {
      return inFlight !== null
    },
  }
}
