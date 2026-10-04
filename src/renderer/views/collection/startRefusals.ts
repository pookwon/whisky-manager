import { TEXT } from '../../../shared/text.js'
import type { StartCollectionResult } from '../../../desktop/ipc.js'

/**
 * Why a press to start a walk did nothing, in the words of the thing the
 * operator can fix. Both the next-step panel and the steps press these starts,
 * so they read the answer from here rather than each spelling it.
 */
export function listStartRefusal(result: StartCollectionResult): string | null {
  if (result.kind === 'refused') return TEXT.collection.refused[result.reason]
  if (result.kind === 'rejected') return TEXT.collection.rejected[result.problem]
  return null
}

export function searchStartRefusal(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.boardSearch.startRefused[result.reason] : null
}

export function probeStartRefusal(result: StartCollectionResult): string | null {
  return result.kind === 'refused' ? TEXT.articleProbe.startRefused[result.reason] : null
}
