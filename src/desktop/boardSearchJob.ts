import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import type { BoardSearchRunner } from './boardSearchRunner.js'
import type { CollectionJob } from './collectionJob.js'

/**
 * The search backfill as one more job the loop takes turns with. It never runs
 * around the clock: the posts it recovers are months old, and a day's wait
 * costs nothing.
 */
export function createBoardSearchJob(deps: { readonly repository: () => BoardSearchRepository | null; readonly runner: BoardSearchRunner }): CollectionJob {
  return {
    name: 'boardSearch',
    async readProgress() {
      const repository = deps.repository()
      const rows = repository === null ? [] : await repository.listQueries()
      if (rows.length === 0) return { exists: false, complete: false, forced: false }
      return { exists: true, complete: rows.every((row) => row.complete), forced: false }
    },
    start(maxPages) {
      return deps.runner.start({ maxPages })
    },
  }
}
