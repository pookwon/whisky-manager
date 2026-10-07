import { extendBoardSearchQueries } from '../shared/boardSearchDictionary.js'
import type { ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { CollectionRepository } from './collection-db/repository.js'
import type { ArticleProbeRunner } from './articleProbeRunner.js'
import { planBoardSearchJob } from './boardSearchPlan.js'
import type { BoardSearchRunner } from './boardSearchRunner.js'
import type { CollectionBlockEnd } from './collectionBlockEnd.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import {
  collectionPipelineStage,
  type CollectionPeriodDays,
  type CollectionPipelineStage,
} from './collectionPipelineStage.js'
import type { CollectionRunKind, CollectionRunner, CollectionStartResult } from './collectionRunner.js'
import { describeJob, type JobDescription } from './collectionScope.js'

export interface CollectionPipelineStores {
  readonly collection: CollectionRepository
  readonly boardSearch: BoardSearchRepository
  readonly articleProbe: ArticleProbeRepository
}

export interface CollectionPipelineDeps {
  readonly stores: () => CollectionPipelineStores | null
  readonly listRunner: CollectionRunner
  readonly searchRunner: BoardSearchRunner
  readonly probeRunner: ArticleProbeRunner
  readonly clock: CollectionClock
  readonly onError?: (error: unknown) => void
  /** A stage passed without a walk, and why, for the diagnostics log. */
  readonly onSkipped?: (message: string) => void
}

export interface CollectionPipelineStartRequest {
  readonly maxPages: number
  /** `backfill` when the operator pressed, `incremental` when the loop's beat started it. */
  readonly runKind: CollectionRunKind
}

export interface CollectionPipelineReading {
  readonly stage: CollectionPipelineStage
  /** The list's own "around the clock"; the search and the probe never run through the night. */
  readonly forced: boolean
}

export interface CollectionPipeline {
  /** Null without collection storage. Reads only; makes no job. */
  read(): Promise<CollectionPipelineReading | null>
  start(request: CollectionPipelineStartRequest): Promise<CollectionStartResult>
  /** Stops the walk in flight and ends the chain: nothing starts after it. */
  stop(): void
  /** From a start until its chain ends, including between two stages. */
  isRunning(): boolean
}

type ListStage = Extract<CollectionPipelineStage, { kind: 'list' }>
type SearchStage = Extract<CollectionPipelineStage, { kind: 'search' }>

type PreparedStage =
  | { readonly stage: ListStage; readonly job: JobDescription }
  | { readonly stage: Exclude<CollectionPipelineStage, { kind: 'list' }>; readonly job: JobDescription | null }

/** What the chain compares to tell a stage that went round without reading. */
const stageKey = (stage: CollectionPipelineStage): string => (stage.kind === 'search' ? `search:${stage.boardId}` : stage.kind)

/**
 * The order of the three walks of a period — the list, the search of each
 * board the list could not finish, the article id holes of the whole period —
 * and the making of the second and third walk's jobs. A block that drains its
 * walk with budget to spare goes on to the next stage in the same block.
 *
 * How any walk reads is its runner's; when a block starts is the loop's.
 */
export function createCollectionPipeline(deps: CollectionPipelineDeps): CollectionPipeline {
  let chainRunning = false
  let stopRequested = false
  const at = () => new Date(deps.clock.now())
  const anyRunnerRunning = () => deps.listRunner.isRunning() || deps.searchRunner.isRunning() || deps.probeRunner.isRunning()

  /** True when the board's search job is ready to walk; false when the board needs nothing more, now marked. */
  async function ensureSearchJob(stores: CollectionPipelineStores, stage: SearchStage): Promise<boolean> {
    const { boardSearch, collection } = stores
    const now = at()
    const queries = await boardSearch.listQueries()
    const first = queries[0]
    const adopted = first !== undefined && first.boardId === stage.boardId && first.fromDay === stage.period.fromDay
    if (!adopted) {
      const plan = await planBoardSearchJob(boardSearch, { boardId: stage.boardId, fromDay: stage.period.fromDay })
      if (plan.kind === 'refused') {
        deps.onSkipped?.(`search ${stage.boardId}: ${plan.reason}`)
        await collection.markSearchFinished(stage.boardId, now)
        return false
      }
      // The plan already holds the longer forms, so a new job is extended as made.
      await boardSearch.replaceJob({ boardId: plan.boardId, fromDay: plan.fromDay, toDay: plan.toDay, queries: plan.queries, at: now })
      await collection.markSearchExtended(stage.boardId, now)
      return true
    }
    let added = 0
    if (!stage.searchExtended) {
      const titles = await boardSearch.readBoardTitles(stage.boardId)
      added = await boardSearch.extendJob({ queries: extendBoardSearchQueries(titles, queries.map((entry) => entry.query)), at: now })
      await collection.markSearchExtended(stage.boardId, now)
    }
    if (added === 0 && queries.every((entry) => entry.complete)) {
      await collection.markSearchFinished(stage.boardId, now)
      return false
    }
    return true
  }

  /** True when the period's probe job has ids waiting; false when the period is done, now marked. */
  async function ensureProbeJob(stores: CollectionPipelineStores, period: CollectionPeriodDays): Promise<boolean> {
    const { articleProbe, collection } = stores
    const job = await articleProbe.readJob(period)
    // `createJob` throws while another window's ids wait; its text says so.
    const finished = job === null ? (await articleProbe.createJob(period)) === 0 : job.probed === job.total
    if (finished) await collection.markProbeFinished(at())
    return !finished
  }

  async function prepare(stores: CollectionPipelineStores): Promise<PreparedStage> {
    for (;;) {
      const job = describeJob(await stores.collection.listFeedStates())
      if (job === null) return { stage: { kind: 'idle' }, job }
      const stage = collectionPipelineStage(job)
      if (stage.kind === 'search' && !(await ensureSearchJob(stores, stage))) continue
      if (stage.kind === 'probe' && !(await ensureProbeJob(stores, stage.period))) continue
      if (stage.kind === 'list') return { stage, job }
      return { stage, job }
    }
  }

  function startRunner(prepared: PreparedStage, request: CollectionPipelineStartRequest, budget: number, onBlockEnd: (end: CollectionBlockEnd) => void): CollectionStartResult {
    const { stage, job } = prepared
    if (stage.kind === 'list' && job !== null) {
      return deps.listRunner.start({
        range: { startMs: job.targetStartMs, endMs: job.targetEndMs },
        kind: request.runKind,
        maxPages: budget,
        feeds: job.remaining.map((row) => row.feed),
        resumeFromCheckpoint: true,
        onBlockEnd,
      })
    }
    if (stage.kind === 'search') return deps.searchRunner.start({ maxPages: budget, onBlockEnd })
    if (stage.kind === 'probe') return deps.probeRunner.start({ maxPages: budget, window: stage.period, onBlockEnd })
    return { kind: 'refused', reason: stage.kind === 'idle' ? 'NO_JOB' : 'JOB_FINISHED' }
  }

  async function runStage(
    stores: CollectionPipelineStores,
    request: CollectionPipelineStartRequest,
    budget: number,
    previous: { readonly key: string; readonly requests: number } | null,
  ): Promise<CollectionStartResult> {
    let prepared: PreparedStage
    try {
      prepared = await prepare(stores)
    } catch (error) {
      deps.onError?.(error)
      chainRunning = false
      return { kind: 'refused', reason: 'STEP_FAILED' }
    }
    const { stage } = prepared
    if (stopRequested || (previous !== null && previous.requests === 0 && previous.key === stageKey(stage))) {
      chainRunning = false
      return { kind: 'refused', reason: 'JOB_FINISHED' }
    }
    const onBlockEnd = (end: CollectionBlockEnd): void => {
      const left = budget - end.requests
      if (stopRequested || end.endedBy !== 'drained' || left <= 0) {
        chainRunning = false
        return
      }
      runStage(stores, request, left, { key: stageKey(stage), requests: end.requests })
        .then((result) => {
          // A refusal here has no one pressing to be told: a member walk the
          // loop started meanwhile, or the extension gone.
          if (result.kind === 'refused' && result.reason !== 'JOB_FINISHED') deps.onSkipped?.(`after ${stageKey(stage)}: next stage refused ${result.reason}`)
        })
        .catch((error: unknown) => {
          deps.onError?.(error)
          chainRunning = false
        })
    }
    const started = startRunner(prepared, request, budget, onBlockEnd)
    if (started.kind !== 'started') chainRunning = false
    return started
  }

  return {
    async read() {
      const stores = deps.stores()
      if (stores === null) return null
      const job = describeJob(await stores.collection.listFeedStates())
      const stage = collectionPipelineStage(job)
      return { stage, forced: stage.kind === 'list' && job?.forced === true }
    },
    async start(request) {
      if (chainRunning || anyRunnerRunning()) return { kind: 'refused', reason: 'ALREADY_RUNNING' }
      const stores = deps.stores()
      if (stores === null) return { kind: 'refused', reason: 'NO_STORAGE' }
      chainRunning = true
      stopRequested = false
      return await runStage(stores, request, request.maxPages, null)
    },
    stop() {
      stopRequested = true
      deps.listRunner.stop()
      deps.searchRunner.stop()
      deps.probeRunner.stop()
    },
    isRunning() {
      return chainRunning || anyRunnerRunning()
    },
  }
}
