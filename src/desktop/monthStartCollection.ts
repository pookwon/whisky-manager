import type { MonthStartSeed } from '../shared/monthStartSeed.js'
import { isMonthStartWindow, previousKstMonthRange } from '../shared/monthStart.js'
import type { CollectionRepository } from './collection-db/repository.js'
import { collectionPipelineStage } from './collectionPipelineStage.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import { describeJob, type JobDescription } from './collectionScope.js'

export interface MonthStartCollectionDeps {
  readonly repository: () => CollectionRepository | null
  /** Whether a pipeline chain or one of its walks is in flight. */
  readonly isPipelineRunning: () => boolean
  /** Whether the collection schedule is on; with it off nothing walks the job, so none is made. */
  readonly scheduleEnabled: () => boolean
  readonly clock: CollectionClock
  readonly onSeeded?: (seed: MonthStartSeed) => void
  readonly onError?: (error: unknown) => void
}

const coversMonth = (job: JobDescription | null, range: { readonly startMs: number; readonly endMs: number }): boolean =>
  job !== null && job.targetStartMs <= range.startMs && job.targetEndMs >= range.endMs

/** Idle or done: nothing in it is still being walked, so replacing it loses no work. */
const isSettled = (job: JobDescription | null): boolean => {
  const stage = collectionPipelineStage(job).kind
  return stage === 'idle' || stage === 'done'
}

/**
 * Makes last month's whole-cafe job when the month's first days find it missing,
 * so the loop's next block walks it like one the operator had asked for. A month
 * lies well inside the whole list's reach; walking board by board and searching
 * titles exist for the old posts past it.
 *
 * A job that already covers last month is left as it is, and so is one still
 * under way: replacing it would throw away the walk in flight, and the month's
 * turn comes when it is done.
 *
 * The job is read again right before it is replaced, so one the operator made
 * while the first read was in flight is not written over.
 */
export function createMonthStartCollection(deps: MonthStartCollectionDeps): () => Promise<void> {
  let inFlight: Promise<void> | null = null

  async function seed(): Promise<void> {
    const nowMs = deps.clock.now()
    if (!isMonthStartWindow(nowMs) || !deps.scheduleEnabled()) return
    const repository = deps.repository()
    if (repository === null || deps.isPipelineRunning()) return
    const range = previousKstMonthRange(nowMs)
    const job = describeJob(await repository.listFeedStates())
    if (coversMonth(job, range) || !isSettled(job)) return
    const latest = describeJob(await repository.listFeedStates())
    if (deps.isPipelineRunning() || latest?.targetStartMs !== job?.targetStartMs || latest?.targetEndMs !== job?.targetEndMs) return
    await repository.replaceJob({ scope: 'all_articles', targetStartMs: range.startMs, targetEndMs: range.endMs, at: new Date(nowMs) })
    deps.onSeeded?.({
      period: range,
      replaced: job === null ? null : { startMs: job.targetStartMs, endMs: job.targetEndMs },
      madeAtMs: nowMs,
    })
  }

  return () => {
    inFlight ??= seed()
      .catch((error: unknown) => {
        deps.onError?.(error)
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }
}
