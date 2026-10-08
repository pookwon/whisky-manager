import { stopReasonCode } from '../../../shared/stopReasonCode.js'
import { TEXT } from '../../../shared/text.js'

/**
 * A stop reason as the operator reads it: what the code means, then the code
 * and detail as the run wrote them. An unknown code is shown as itself rather
 * than behind a sentence that would say nothing.
 */
export function describeStopReason(stopReason: string): string {
  const meaning = TEXT.collectionStopReason[stopReasonCode(stopReason)]
  return meaning === undefined ? stopReason : TEXT.collectionStopReasonWith(meaning, stopReason)
}
