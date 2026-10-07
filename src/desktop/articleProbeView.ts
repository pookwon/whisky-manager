import type { ArticleProbeBlockFailure, ArticleProbeProgress } from './articleProbeRunner.js'
import type { ArticleProbeJob, ArticleProbeLastRun, ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { CollectionPeriodDays } from './collectionPipelineStage.js'

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
}

export async function readArticleProbeView(inputs: {
  readonly repository: ArticleProbeRepository
  readonly period: CollectionPeriodDays | null
  readonly running: boolean
  readonly progress: ArticleProbeProgress | null
  readonly blockFailure: ArticleProbeBlockFailure | null
}): Promise<ArticleProbeView> {
  const [job, lastRun] = await Promise.all([
    inputs.period !== null ? inputs.repository.readJob(inputs.period) : Promise.resolve(null),
    inputs.repository.readLastRun(),
  ])
  return { running: inputs.running, progress: inputs.progress, blockFailure: inputs.blockFailure, lastRun, job }
}
