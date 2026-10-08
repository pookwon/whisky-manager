/**
 * The bare code back off a stop reason written as `CODE: detail`. Shared because
 * the pipeline matches on it and the screens name it in Korean, and neither
 * side may import the other's modules.
 */
export function stopReasonCode(stopReason: string): string {
  const colon = stopReason.indexOf(': ')
  return colon === -1 ? stopReason : stopReason.slice(0, colon)
}
