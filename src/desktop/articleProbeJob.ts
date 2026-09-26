import type { ArticleProbeRunner } from './articleProbeRunner.js'
import type { ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import type { CollectionJob } from './collectionJob.js'

/**
 * Reading the gap's ids one by one, as one more job the loop takes turns with.
 * Like the search backfill it never runs around the clock: the posts are
 * months old, and a day's wait costs nothing.
 */
export function createArticleProbeJob(deps: { readonly repository: () => ArticleProbeRepository | null; readonly runner: ArticleProbeRunner }): CollectionJob {
  return {
    name: 'articleProbe',
    async readProgress() {
      const repository = deps.repository()
      const job = repository === null ? null : await repository.readJob()
      if (job === null) return { exists: false, complete: false, forced: false }
      return { exists: true, complete: job.probed === job.total, forced: false }
    },
    start(maxPages) {
      return deps.runner.start({ maxPages })
    },
  }
}
