import type { CommentAuthor, ExecutionStrategy } from './types.js'
import type { RawMember } from './members.js'

export const PROTOCOL_VERSION = 3

/** No call may wait forever. Every value stays under the MV3 30s fetch ceiling. */
export const TIMEOUTS = {
  loginCheckMs: 10_000,
  collectMs: 15_000,
  executeMs: 15_000,
  commentCheckMs: 10_000,
  fetchMembersMs: 15_000,
  probeMs: 20_000,
  extensionReplyMs: 20_000,
} as const

export interface SourceRef {
  readonly cafeId: string
  readonly boardId: string
}

export interface RawCandidate {
  readonly postId: string
  readonly title: string | null
  readonly bodyText: string | null
  readonly authorNickname: string | null
  readonly authorId: string | null
  readonly postedAt: number
  /** Authors of comments already on the post. `null` means the check failed. */
  readonly existingCommentAuthors: CommentAuthor[] | null
}

/** Semantic action. Endpoints, tokens and selectors stay inside the extension. */
export interface ActionEnvelope {
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly body: string
}

export interface PostRef {
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
}

export type AppMessage =
  | { type: 'HELLO_ACK'; accepted: boolean; reason: string | null }
  /** Carries the board so the check proves access to it, not just to naver. */
  | { type: 'CHECK_LOGIN'; requestId: string; source: SourceRef }
  | { type: 'COLLECT'; requestId: string; automationId: string; source: SourceRef; sincePostId: string | null; sincePostedAt: number | null }
  | { type: 'CHECK_COMMENTS'; requestId: string; automationId: string; action: PostRef }
  | { type: 'EXECUTE'; requestId: string; automationId: string; action: ActionEnvelope }
  /** Cafe-wide, not board-scoped: a member belongs to the cafe, not a board. */
  | { type: 'FETCH_MEMBERS'; requestId: string; cafeId: string; page: number; perPage: number }
  /** Diagnostic only. See `isProbeTarget` for the hosts this may reach. */
  | { type: 'PROBE'; requestId: string; url: string }
  | { type: 'ABORT'; requestId: string }

export type ExtensionMessage =
  | { type: 'HELLO'; token: string; extensionId: string; protocolVersion: number }
  | { type: 'LOGIN_STATE'; requestId: string; loggedIn: boolean; account: string | null }
  | { type: 'COLLECTED'; requestId: string; candidates: RawCandidate[] }
  | { type: 'COMMENTS'; requestId: string; authors: CommentAuthor[] | null }
  | {
      type: 'EXECUTED'
      requestId: string
      ok: boolean
      strategy: ExecutionStrategy | null
      commentAuthors: CommentAuthor[] | null
      error: string | null
      /**
       * What the endpoint actually said when execution failed. These endpoints
       * are undocumented and answer 200 even when they reject a write, so the
       * code alone cannot tell an operator what changed.
       */
      diagnostic: string | null
    }
  | /** `null` means the list could not be read, as with `COMMENTS`. */
    { type: 'MEMBERS'; requestId: string; members: RawMember[] | null }
  | {
      type: 'PROBE_RESULT'
      requestId: string
      status: number
      contentType: string | null
      /** Body decoded with the charset the response declared. */
      text: string
      error: string | null
    }
  | { type: 'ERROR'; requestId: string | null; code: string; message: string }

const APP_MESSAGE_TYPES = new Set<string>([
  'HELLO_ACK',
  'CHECK_LOGIN',
  'COLLECT',
  'CHECK_COMMENTS',
  'EXECUTE',
  'FETCH_MEMBERS',
  'PROBE',
  'ABORT',
])
const EXTENSION_MESSAGE_TYPES = new Set<string>([
  'HELLO',
  'LOGIN_STATE',
  'COLLECTED',
  'COMMENTS',
  'EXECUTED',
  'MEMBERS',
  'PROBE_RESULT',
  'ERROR',
])

function messageType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

export function isAppMessage(value: unknown): value is AppMessage {
  const type = messageType(value)
  return type !== null && APP_MESSAGE_TYPES.has(type)
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  const type = messageType(value)
  return type !== null && EXTENSION_MESSAGE_TYPES.has(type)
}
