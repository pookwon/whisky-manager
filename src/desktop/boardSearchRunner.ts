import type { CollectionPacing } from '../shared/collectionPacing.js'
import { BOARD_SEARCH_CAP_PAGE, CAFE_BOARD_SEARCH } from '../shared/cafeBoardSearchEndpoint.js'
import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import { kstDayKey, kstDayKeyRange, MS_PER_DAY } from '../shared/kst.js'
import type { Random } from '../shared/ports.js'
import type { BoardSearchQueryState, BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from './boardSearchPageFetcher.js'
import { assertBoardSearchPage, assertBoardSearchPageFollows } from './boardSearchPageCheck.js'
import type { CollectionBlockEnd, OnCollectionBlockEnd } from './collectionBlockEnd.js'
import type { CollectionLock } from './collectionLock.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import { CollectionPageError } from './collectionPageError.js'
import { waitForReadTurn, type ReadTurnDeps } from './collectionReadTurn.js'
import type { CollectionStartResult } from './collectionRunner.js'
import { failedRunStopReason, type FailedRunStopReason } from './failedRunStopReason.js'

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

/** Where a block in flight stands. */
export interface BoardSearchProgress {
  /** The query being walked. */
  readonly query: string
  /** Page requests this block has made, over every query it walked. */
  readonly requestedPages: number
  readonly maxPages: number
}

/** Why a block ended with no run row to say it: a run could not be started, or the walk itself threw. */
export interface BoardSearchBlockFailure extends FailedRunStopReason {
  readonly atMs: number
}

export interface BoardSearchRunner {
  /** `requestsBefore`: requests the block made before this walk; its pacing counts on from them. */
  start(request: { readonly maxPages: number; readonly onBlockEnd?: OnCollectionBlockEnd; readonly requestsBefore?: number }): CollectionStartResult
  stop(): void
  isRunning(): boolean
  /** Null between blocks, and while a block has not reached its first query. */
  progress(): BoardSearchProgress | null
  /** The last block's failure that no run row records; null again once a block starts. */
  blockFailure(): BoardSearchBlockFailure | null
}

/**
 * The failures that belong to one query's results. Anything else — a refused
 * or unreadable request — would meet every query after it the same way, and
 * going on would only spend the budget one failed run at a time.
 */
const QUERY_OWN_FAILURES: ReadonlySet<string> = new Set(['BOARD_SEARCH_WRONG_BOARD', 'BOARD_SEARCH_OUT_OF_WINDOW', 'BOARD_PAGE_DUPLICATE_POST'])

export function isQueryOwnFailure(code: string): boolean {
  return QUERY_OWN_FAILURES.has(code)
}

type QueryOutcome = {
  readonly requests: number
  readonly endsBlock: boolean
  /** Whether the query's run closed `failed`, or could not be started. */
  readonly failed: boolean
  /** The failure of a run that could not be started, which no row records. */
  readonly unrecorded?: FailedRunStopReason
}

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
  let lastBlockFailure: BoardSearchBlockFailure | null = null
  let blockProgress: BoardSearchProgress | null = null

  const keepBlockFailure = (failure: FailedRunStopReason): void => {
    lastBlockFailure = { ...failure, atMs: deps.clock.now() }
  }

  const readTurn: ReadTurnDeps = {
    isSessionBusy: () => deps.isSessionBusy(),
    sleep: (ms) => deps.sleep(ms),
    random: deps.random,
    isAborted: () => abortRequested,
  }

  /**
   * One query, from its cursor to its empty page or the end of the budget. A
   * resumed query reads its last stored page again: a post deleted from the
   * window since then pulls the results forward, and the re-read picks up the
   * one that slid onto it. The request window is the query's segment; a
   * narrower one goes on in the same run from its first page.
   */
  async function walkQuery(repository: BoardSearchRepository, query: BoardSearchQueryState, budget: number, spentBefore: number, waitTurn: (ordinal: number) => Promise<void>): Promise<QueryOutcome> {
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
    } catch (error) {
      // No row to finish. Whatever refused this insert would refuse the next.
      return { requests, endsBlock: true, failed: true, unrecorded: failedRunStopReason(error) }
    }
    try {
      for (;;) {
        if (requests >= budget) {
          await repository.finishRun(runId, 'partial', 'PAGE_BUDGET_SPENT', now())
          return { requests, endsBlock: false, failed: false }
        }
        await waitTurn(spentBefore + requests + 1)
        await repository.recordPageRequest(runId)
        requests += 1
        if (blockProgress !== null) blockProgress = { ...blockProgress, requestedPages: spentBefore + requests }
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
          return { requests, endsBlock: false, failed: false }
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
        return { requests, endsBlock: true, failed: false }
      }
      const failure = failedRunStopReason(error)
      await close('failed', failure.stopReason)
      return { requests, endsBlock: !isQueryOwnFailure(failure.code), failed: true }
    }
  }

  /**
   * A block over the queue: unused budget passes on and a query's own failure
   * moves on; a stop, or a failure every query would share, ends the block.
   * It first closes any search run an earlier block could not: the lock is
   * held, so none is being written, and a board's one running search run
   * would refuse every run this block starts.
   */
  async function walk(repository: BoardSearchRepository, maxPages: number, requestsBefore: number, report: (requests: number) => void): Promise<{ readonly spent: number; readonly failed: boolean }> {
    await repository.reconcileOrphanedRuns(new Date(deps.clock.now()))
    const pacing = deps.pacing()
    const waitTurn = (ordinal: number) => waitForReadTurn(readTurn, requestsBefore + ordinal, pacing)
    let spent = 0
    let failed = false
    for (const query of await repository.listQueries()) {
      if (query.complete) continue
      if (abortRequested || spent >= maxPages) break
      blockProgress = { query: query.query, requestedPages: spent, maxPages }
      const outcome = await walkQuery(repository, query, maxPages - spent, spent, waitTurn)
      spent += outcome.requests
      report(spent)
      failed ||= outcome.failed
      if (outcome.unrecorded !== undefined) keepBlockFailure(outcome.unrecorded)
      if (outcome.endsBlock) break
    }
    return { spent, failed }
  }

  return {
    start(request) {
      if (inFlight !== null) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const repository = deps.repository()
      if (repository === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      if (!deps.isConnected()) return { kind: 'refused', reason: 'BRIDGE_OFFLINE' }
      if (!deps.lock.tryAcquire()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      abortRequested = false
      lastBlockFailure = null
      let spent = 0
      let end: CollectionBlockEnd = { requests: 0, endedBy: 'failed' }
      inFlight = walk(repository, request.maxPages, request.requestsBefore ?? 0, (requests) => { spent = requests })
        .then((walked) => {
          const endedBy = abortRequested ? 'stopped' : walked.failed ? 'failed' : walked.spent >= request.maxPages ? 'budget' : 'drained'
          end = { requests: walked.spent, endedBy }
        })
        .catch((error: unknown) => {
          end = { requests: spent, endedBy: abortRequested ? 'stopped' : 'failed' }
          deps.onError?.(error)
          keepBlockFailure(failedRunStopReason(error))
        })
        .finally(() => {
          inFlight = null
          blockProgress = null
          deps.lock.release()
          // The next walk may be started from here; a throw is reported, not left to reject the block.
          try { request.onBlockEnd?.(end) } catch (error) { deps.onError?.(error) }
        })
      return { kind: 'started' }
    },
    stop() {
      abortRequested = true
    },
    isRunning() {
      return inFlight !== null
    },
    progress() {
      return blockProgress
    },
    blockFailure() {
      return lastBlockFailure
    },
  }
}
