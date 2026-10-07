import type { CollectionJob } from './collectionJob.js'
import type { CollectionPipeline } from './collectionPipeline.js'

/**
 * The list walk, the search backfill and the article probe as the one job the
 * loop takes turns with: which of the three a block walks is the pipeline's
 * to say, and a block that finishes one goes on to the next.
 */
export function createCollectionPipelineJob(deps: { readonly pipeline: CollectionPipeline }): CollectionJob {
  return {
    name: 'pipeline',
    async readProgress() {
      const reading = await deps.pipeline.read()
      if (reading === null || reading.stage.kind === 'idle') return { exists: false, complete: false, forced: false }
      return { exists: true, complete: reading.stage.kind === 'done', forced: reading.forced }
    },
    start(maxPages) {
      return deps.pipeline.start({ maxPages, runKind: 'incremental' })
    },
  }
}
