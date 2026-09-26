import type { CollectionPacing } from '../shared/collectionPacing.js'
import type { Random } from '../shared/ports.js'
import type { ArticleFetcher } from './articleFetcher.js'
import { judgeArticleRead } from './articleProbeVerdict.js'
import type { ArticleProbeJob, ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { CollectionLock } from './collectionLock.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import { CollectionPageError } from './collectionPageError.js'
import { waitForReadTurn, type ReadTurnDeps } from './collectionReadTurn.js'
import type { CollectionStartResult } from './collectionRunner.js'
import { failedRunStopReason, type FailedRunStopReason } from './failedRunStopReason.js'

export interface ArticleProbeRunnerDeps {
  readonly repository: () => ArticleProbeRepository | null
  readonly fetcher: ArticleFetcher
  readonly isConnected: () => boolean
  readonly clock: CollectionClock
  readonly random: Random
  /** Read once per block, like the other walks': the budget came from the same pacing. */
  readonly pacing: () => CollectionPacing
  readonly sleep: (ms: number) => Promise<void>
  readonly isSessionBusy: () => boolean
  /** The same lock every walk takes: one browser session, one walk. */
  readonly lock: CollectionLock
  readonly newId: () => string
  readonly onError?: (error: unknown) => void
}

/** Where a block in flight stands. */
export interface ArticleProbeProgress {
  /** Article requests this block has made. */
  readonly requested: number
  readonly maxPages: number
}

/** Why a block ended with no run row to say it: its run could not be started, or the walk itself threw. */
export interface ArticleProbeBlockFailure extends FailedRunStopReason {
  readonly atMs: number
}

export interface ArticleProbeRunner {
  start(request: { readonly maxPages: number }): CollectionStartResult
  stop(): void
  isRunning(): boolean
  /** Null between blocks, and while a block has not started its run. */
  progress(): ArticleProbeProgress | null
  /** The last block's failure that no run row records; null again once a block starts. */
  blockFailure(): ArticleProbeBlockFailure | null
}

export function createArticleProbeRunner(deps: ArticleProbeRunnerDeps): ArticleProbeRunner {
  let inFlight: Promise<void> | null = null
  let abortRequested = false
  let lastBlockFailure: ArticleProbeBlockFailure | null = null
  let blockProgress: ArticleProbeProgress | null = null

  const keepBlockFailure = (failure: FailedRunStopReason): void => {
    lastBlockFailure = { ...failure, atMs: deps.clock.now() }
  }
  const now = () => new Date(deps.clock.now())

  const readTurn: ReadTurnDeps = {
    isSessionBusy: () => deps.isSessionBusy(),
    sleep: (ms) => deps.sleep(ms),
    random: deps.random,
    isAborted: () => abortRequested,
  }

  /**
   * The waiting ids in ascending order, from the smallest unanswered one: that
   * is the whole cursor. An id another walk stored since the job was made is
   * closed as stored without a request. Any failure ends the block and leaves
   * its id waiting: whatever refused one read would refuse the next.
   */
  async function walkIds(repository: ArticleProbeRepository, runId: string, maxPages: number, pacing: CollectionPacing): Promise<void> {
    const collectedBoardIds = new Set(await repository.listCollectedBoardIds())
    let requested = 0
    for (;;) {
      if (abortRequested) throw new CollectionPageError('ABORTED')
      const postId = await repository.nextWaitingId()
      if (postId === null) {
        await repository.finishRun(runId, 'succeeded', null, now())
        return
      }
      const storedOn = await repository.storedBoardOf(postId)
      if (storedOn !== null) {
        await repository.recordVerdict({ runId, postId, observedAt: now(), requested: false, verdict: { outcome: 'stored', boardId: storedOn, post: null } })
        continue
      }
      if (requested >= maxPages) {
        await repository.finishRun(runId, 'partial', 'PAGE_BUDGET_SPENT', now())
        return
      }
      await waitForReadTurn(readTurn, requested + 1, pacing)
      await repository.recordPageRequest(runId)
      requested += 1
      blockProgress = { requested, maxPages }
      const observedAt = now()
      const verdict = judgeArticleRead(postId, await deps.fetcher.read(postId), collectedBoardIds)
      await repository.recordVerdict({ runId, postId, observedAt, requested: true, verdict })
    }
  }

  /** One block is one run. It first closes a probe run an earlier block could not: the lock is held, so none is being written. */
  async function walk(repository: ArticleProbeRepository, maxPages: number): Promise<void> {
    await repository.reconcileOrphanedRuns(now())
    const job: ArticleProbeJob | null = await repository.readJob()
    if (job === null || job.probed === job.total || abortRequested) return
    const pacing = deps.pacing()
    const runId = deps.newId()
    try {
      await repository.startRun({ id: runId, fromDay: job.fromDay, toDay: job.toDay, startedAt: now() })
    } catch (error) {
      // No row to finish, and none to say why.
      keepBlockFailure(failedRunStopReason(error))
      return
    }
    blockProgress = { requested: 0, maxPages }
    try {
      await walkIds(repository, runId, maxPages, pacing)
    } catch (error) {
      // A run this write cannot close stays `running` until the next block's
      // sweep; the failure is reported, since nothing else would say why.
      const close = (status: 'failed' | 'interrupted', stopReason: string) =>
        repository.finishRun(runId, status, stopReason, now()).catch((closeError: unknown) => { deps.onError?.(closeError) })
      if (error instanceof CollectionPageError && error.code === 'ABORTED') {
        await close('interrupted', 'ABORTED')
        return
      }
      await close('failed', failedRunStopReason(error).stopReason)
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
      lastBlockFailure = null
      inFlight = walk(repository, request.maxPages)
        .catch((error: unknown) => {
          deps.onError?.(error)
          keepBlockFailure(failedRunStopReason(error))
        })
        .finally(() => {
          inFlight = null
          blockProgress = null
          deps.lock.release()
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
