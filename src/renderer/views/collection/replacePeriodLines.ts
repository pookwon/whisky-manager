import { TEXT } from '../../../shared/text.js'
import type { CollectionPipelineStage } from '../../../desktop/collectionPipelineStage.js'

/**
 * What replacing the period costs beyond the list's place: once the list is
 * done, the period's search backfill and article-number check are what is
 * under way, and a new period starts them over too.
 */
export function replaceLaterStepsLine(stage: CollectionPipelineStage): string | null {
  return stage.kind === 'search' || stage.kind === 'probe' ? TEXT.collection.replace.laterStepsCost : null
}
