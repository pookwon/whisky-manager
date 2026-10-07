import { articleProbeWindow, type ArticleProbeWindow } from './articleProbePlan.js'
import type { ArticleProbeBlockFailure, ArticleProbeProgress } from './articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeLastRun, ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'

/** What the article probe card shows. */
export interface ArticleProbeView {
  readonly running: boolean
  /** The block in flight's progress; null when none runs. */
  readonly progress: ArticleProbeProgress | null
  /** Why the last block ended with no run row saying it; null once a block starts again. */
  readonly blockFailure: ArticleProbeBlockFailure | null
  /** The feed's newest run, since probe runs stay off the recent log. */
  readonly lastRun: ArticleProbeLastRun | null
  readonly job: ArticleProbeJob | null
  /** While there is no job: the window one would take, or why none can be made. Null once a job exists. */
  readonly window: ArticleProbeWindow | null
}

export async function readArticleProbeView(inputs: {
  readonly repository: ArticleProbeRepository
  readonly search: BoardSearchRepository
  readonly running: boolean
  readonly progress: ArticleProbeProgress | null
  readonly blockFailure: ArticleProbeBlockFailure | null
}): Promise<ArticleProbeView> {
  const window = articleProbeWindow(await inputs.search.listQueries())
  const [job, lastRun] = await Promise.all([
    window.kind === 'ready' ? inputs.repository.readJob(window) : Promise.resolve(null),
    inputs.repository.readLastRun(),
  ])
  return { running: inputs.running, progress: inputs.progress, blockFailure: inputs.blockFailure, lastRun, job, window: job === null ? window : null }
}
