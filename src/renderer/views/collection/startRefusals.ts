import { TEXT } from '../../../shared/text.js'
import type { StartCollectionResult } from '../../../desktop/ipc.js'

/**
 * Why a press to start the list walk did nothing, in the words of the thing
 * the operator can fix. The next-step panel presses this start, so it reads
 * the answer from here rather than spelling it.
 */
export function listStartRefusal(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.collection.refused[result.reason]
  if (result.kind === 'rejected') return TEXT.collection.rejected[result.problem]
  return null
}
