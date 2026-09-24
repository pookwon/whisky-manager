import type { CollectionPacing } from '../shared/collectionPacing.js'
import { collectionDelayMs } from '../shared/collectionPacing.js'
import type { Random } from '../shared/ports.js'
import type { BoardSearchQueryState, BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from './boardSearchPageFetcher.js'
import { assertBoardSearchPage } from './boardSearchPageCheck.js'
import type { CollectionLock } from './collectionLock.js'
import { CollectionPageError, type CollectionClock } from './collectionOrchestrator.js'
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
   * one that slid onto it.
   */
  async function walkQuery(repository: BoardSearchRepository, query: BoardSearchQueryState, budget: number, spentBefore: number, pacing: CollectionPacing): Promise<QueryOutcome> {
    const runId = deps.newId()
    let requests = 0
    let pageNumber = query.lastCommittedPage ?? 1
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
        const result = await deps.fetcher.read({ menuId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, page: pageNumber })
        if (result.items.length === 0) {
          await repository.finishRun(runId, 'succeeded', null, now())
          return { requests, endsBlock: false }
        }
        assertBoardSearchPage(result, query)
        await repository.persistPage({ runId, boardId: query.boardId, query: query.query, fromDay: query.fromDay, toDay: query.toDay, page: pageNumber, observedAt, result })
        pageNumber += 1
      }
    } catch (error) {
      // A run row left behind as running is the lesser harm here: letting the
      // write's own failure end the block would strand every query after it.
      if (error instanceof CollectionPageError && error.code === 'ABORTED') {
        await repository.finishRun(runId, 'interrupted', 'ABORTED', now()).catch(() => undefined)
        return { requests, endsBlock: true }
      }
      const failure = failedRunStopReason(error)
      await repository.finishRun(runId, 'failed', failure.stopReason, now()).catch(() => undefined)
      return { requests, endsBlock: !QUERY_OWN_FAILURES.has(failure.code) }
    }
  }

  /**
   * A block over the queue: unused budget passes on and a query's own failure
   * moves on; a stop, or a failure every query would share, ends the block.
   */
  async function walk(repository: BoardSearchRepository, maxPages: number): Promise<void> {
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
