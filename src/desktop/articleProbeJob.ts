import { articleProbeWindow } from './articleProbePlan.js'
import type { ArticleProbeRunner } from './articleProbeRunner.js'
import type { ArticleProbeRepository, ArticleProbeWindowDays } from './collection-db/articleProbeRepository.js'
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { CollectionJob } from './collectionJob.js'

/**
 * Reading the gap's ids one by one, as one more job the loop takes turns with.
 * Like the search backfill it never runs around the clock: the posts are
 * months old, and a day's wait costs nothing. Its window is the finished
 * search job's.
 */
export function createArticleProbeJob(deps: {
  readonly repository: () => ArticleProbeRepository | null
  readonly search: () => BoardSearchRepository | null
  readonly runner: ArticleProbeRunner
}): CollectionJob {
  let window: ArticleProbeWindowDays | null = null
  return {
    name: 'articleProbe',
    async readProgress() {
      window = null
      const repository = deps.repository()
      const search = deps.search()
      if (repository === null || search === null) return { exists: false, complete: false, forced: false }
      const planned = articleProbeWindow(await search.listQueries())
      if (planned.kind !== 'ready') return { exists: false, complete: false, forced: false }
      window = { fromDay: planned.fromDay, toDay: planned.toDay }
      const job = await repository.readJob(window)
      if (job === null) return { exists: false, complete: false, forced: false }
      return { exists: true, complete: job.probed === job.total, forced: false }
    },
    start(maxPages) {
      if (window === null) return { kind: 'refused', reason: 'NO_JOB' }
      return deps.runner.start({ maxPages, window })
    },
  }
}
