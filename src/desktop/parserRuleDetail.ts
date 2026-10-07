import { stopReasonDetail } from './collectionFailure.js'

/**
 * The parser rule an extension's error reply names, kept to a stop reason's
 * bounds — or undefined. Only a reply carrying `parseErrorCode` is read: its
 * message is the extension saying which rule a response broke, by code and
 * path. No other message is: those come from anywhere and say anything.
 */
export function parserRuleDetail(reply: { readonly code: string; readonly message: string }, parseErrorCode: string): string | undefined {
  return reply.code === parseErrorCode && reply.message !== reply.code ? stopReasonDetail(reply.message) : undefined
}
