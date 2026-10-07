import type { ArticleProbeView } from '../../src/desktop/articleProbeView.js'
import type { BoardSearchJobView, BoardSearchView } from '../../src/desktop/boardSearchView.js'
import type { ArticleProbeJob } from '../../src/desktop/collection-db/articleProbeRepository.js'
import { EMPTY_ID_GAP_REPORT } from '../../src/desktop/collection-db/idGapReport.js'
import type { BoardProgress, CollectionJob, CollectionRunSummary, CollectionStatus } from '../../src/desktop/collection-db/statusQuery.js'
import type { CollectionPipelineStage } from '../../src/desktop/collectionPipelineStage.js'
import type { CollectionStepInputs } from '../../src/renderer/views/collection/stepFacts.js'

export const PERIOD = { fromDay: '20240101', toDay: '20250102' }

export const board = (queueOrder: number, boardId: string, state: BoardProgress['state']): BoardProgress => ({
  queueOrder, boardId, name: `게시판${boardId}`, state, cursorPostedAtMs: null, insertedPostCount: 0,
})

export const listJob = (overrides: Partial<CollectionJob> = {}): CollectionJob => ({
  scope: 'board', targetStartMs: 0, targetEndMs: 86_400_000, cursorPostedAtMs: null, cursorUpdatedAtMs: 0,
  complete: false, forced: false, boards: [], ...overrides,
})

export const runningRun: CollectionRunSummary = {
  id: '1', runKind: 'backfill', status: 'running', stopReason: null, startedAtMs: 0, finishedAtMs: null,
  targetStartMs: 0, targetEndMs: 86_400_000, collectionPages: 3, requestPages: 3, insertedPostCount: 10,
  observedPostCount: 10, cursorPostedAtMs: null, boardName: null,
}

export const status = (overrides: Partial<CollectionStatus> = {}): CollectionStatus => ({
  totals: { posts: 0, boards: 0, oldestPostedAtMs: null, newestPostedAtMs: null, lastSnapshotAtMs: null },
  job: null, running: null, recentRuns: [], idGaps: EMPTY_ID_GAP_REPORT, ...overrides,
})

export const searchJob = (overrides: Partial<BoardSearchJobView> = {}): BoardSearchJobView => ({
  boardId: '137', boardName: '국내구입기', fromDay: '20250101', toDay: '20250829', queries: [],
  completedCount: 0, insertedTotal: 0, current: '글렌',
  coverage: { span: 0, missing: 0, baselineMissingRatio: null, estimatedRemaining: null }, ...overrides,
})

export const search = (job: BoardSearchJobView | null, running = false): BoardSearchView => ({
  boards: [], running, progress: null, blockFailure: null, job,
})

export const probeJob = (overrides: Partial<ArticleProbeJob> = {}): ArticleProbeJob => ({
  fromDay: '20250101', toDay: '20250829', total: 100, probed: 0, stored: 0, deleted: 0, unreadable: 0,
  otherBoard: 0, notice: 0, ...overrides,
})

export const probe = (job: ArticleProbeJob | null, running = false): ArticleProbeView => ({
  running, progress: null, blockFailure: null, lastRun: null, job,
})

export const inputs = (overrides: Partial<CollectionStepInputs> = {}): CollectionStepInputs => ({
  status: status(), search: null, probe: null, pipeline: { kind: 'idle' } as CollectionPipelineStage, ...overrides,
})
