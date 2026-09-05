import type { CommentAuthor, ExecutionStrategy } from './types.js'
import type { CollectedArticlePage } from './cafeArticleList.js'
import { CAFE_ARTICLE_LIST, isMenuId } from './cafeArticleFixture.js'
import { CAFE_MEMBER_LIST } from './cafeMemberFixture.js'
import type { CollectedMemberPage } from './cafeMemberList.js'

export const PROTOCOL_VERSION = 10

/**
 * No call may wait forever. Every value bounds the gap between messages, not
 * total elapsed time. Interim collection progress messages reset the timer,
 * so a collection that pages with 2s gaps will report progress every 2s and
 * stay within the timeout despite taking several seconds total.
 */
export const TIMEOUTS = {
  loginCheckMs: 10_000,
  collectMs: 15_000,
  executeMs: 15_000,
  commentCheckMs: 10_000,
  probeMs: 20_000,
  boardPageMs: 20_000,
  memberPageMs: 20_000,
  extensionReplyMs: 20_000,
} as const

export interface CollectMemberPageRequest {
  readonly type: 'COLLECT_MEMBER_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_MEMBER_LIST.cafeId
  readonly page: number
  readonly perPage: typeof CAFE_MEMBER_LIST.perPage
}

export interface CollectBoardPageRequest {
  readonly type: 'COLLECT_BOARD_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId
  /** Digits. `'0'` is the whole cafe; anything else is one board's own list. */
  readonly menuId: string
  readonly page: number
  readonly pageSize: typeof CAFE_ARTICLE_LIST.pageSize
  readonly sortBy: typeof CAFE_ARTICLE_LIST.sortBy
  readonly viewType: typeof CAFE_ARTICLE_LIST.viewType
}

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
  /**
   * How many comments the board list reports. `null` means the list could not
   * be read. The list never names the commenters, so anything above zero has
   * to be resolved against the post before it can be judged.
   */
  readonly commentCount: number | null
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
  | { type: 'COLLECT'; requestId: string; automationId: string; source: SourceRef; sincePostedAt: number }
  | { type: 'CHECK_COMMENTS'; requestId: string; automationId: string; action: PostRef }
  | { type: 'EXECUTE'; requestId: string; automationId: string; action: ActionEnvelope }
  /** One exact menu=0 JSON page; the extension must not follow pagination itself. */
  | CollectBoardPageRequest
  /** One exact member-list page; the extension must not follow pagination itself. */
  | CollectMemberPageRequest
  /** Diagnostic only. See `isProbeTarget` for the hosts this may reach. */
  | { type: 'PROBE'; requestId: string; url: string }
  | { type: 'ABORT'; requestId: string }

export type ExtensionMessage =
  | { type: 'HELLO'; token: string; extensionId: string; protocolVersion: number }
  /**
   * Keeps the extension's service worker alive. Chrome ends an MV3 worker after
   * 30s without activity and the socket dies with it, and only sending or
   * receiving a WebSocket message resets that timer. Between sessions the bridge
   * is silent, so the extension speaks on its own. It answers no request and
   * asks for none: `requestId` is null, and the transport drops it where it
   * drops every other message that is not a reply.
   */
  | { type: 'PING'; requestId: null }
  | { type: 'LOGIN_STATE'; requestId: string; loggedIn: boolean; account: string | null }
  | { type: 'COLLECTED'; requestId: string; candidates: RawCandidate[] }
  | { type: 'COMMENTS'; requestId: string; authors: CommentAuthor[] | null }
  | { type: 'COLLECT_PROGRESS'; requestId: string; pagesRead: number; collected: number }
  | { type: 'BOARD_PAGE_COLLECTED'; requestId: string; page: number; result: CollectedArticlePage }
  | { type: 'MEMBER_PAGE_COLLECTED'; requestId: string; page: number; result: CollectedMemberPage }
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

/**
 * Replies that report on a request still in flight. They are answered by
 * refreshing the caller's patience, never by completing the request.
 *
 * Adding one here without teaching the transport about it would end the request
 * early and silently, so the two are tied together: the record below must name
 * every member of this union, and the compiler rejects it when one is missing.
 */
type InterimType = 'COLLECT_PROGRESS'

const INTERIM_MESSAGE_TYPES: Record<InterimType, true> = { COLLECT_PROGRESS: true }

export type InterimMessage = Extract<ExtensionMessage, { type: InterimType }>

export function isInterimMessage(message: ExtensionMessage): message is InterimMessage {
  return message.type in INTERIM_MESSAGE_TYPES
}

const APP_MESSAGE_TYPES = new Set<string>([
  'HELLO_ACK',
  'CHECK_LOGIN',
  'COLLECT',
  'CHECK_COMMENTS',
  'EXECUTE',
  'COLLECT_BOARD_PAGE',
  'COLLECT_MEMBER_PAGE',
  'PROBE',
  'ABORT',
])
const EXTENSION_MESSAGE_TYPES = new Set<string>([
  'HELLO',
  'PING',
  'LOGIN_STATE',
  'COLLECTED',
  'COMMENTS',
  'COLLECT_PROGRESS',
  'BOARD_PAGE_COLLECTED',
  'MEMBER_PAGE_COLLECTED',
  'EXECUTED',
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
  if (type === 'COLLECT_BOARD_PAGE') return isCollectBoardPageRequest(value)
  if (type === 'COLLECT_MEMBER_PAGE') return isCollectMemberPageRequest(value)
  return type !== null && APP_MESSAGE_TYPES.has(type)
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  const type = messageType(value)
  if (type === 'BOARD_PAGE_COLLECTED') return isBoardPageCollected(value)
  if (type === 'MEMBER_PAGE_COLLECTED') return isMemberPageCollected(value)
  return type !== null && EXTENSION_MESSAGE_TYPES.has(type)
}

/** Runtime guard for one cafe, one list endpoint, any of its menus. */
export function isCollectBoardPageRequest(value: unknown): value is CollectBoardPageRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<CollectBoardPageRequest>
  return (
    message.type === 'COLLECT_BOARD_PAGE' &&
    typeof message.requestId === 'string' &&
    message.cafeId === CAFE_ARTICLE_LIST.cafeId &&
    typeof message.menuId === 'string' && isMenuId(message.menuId) &&
    typeof message.page === 'number' &&
    Number.isSafeInteger(message.page) &&
    message.page >= 1 &&
    message.pageSize === CAFE_ARTICLE_LIST.pageSize &&
    message.sortBy === CAFE_ARTICLE_LIST.sortBy &&
    message.viewType === CAFE_ARTICLE_LIST.viewType
  )
}

function isBoardPageCollected(value: unknown): value is Extract<ExtensionMessage, { type: 'BOARD_PAGE_COLLECTED' }> {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { type?: unknown; requestId?: unknown; page?: unknown; result?: unknown }
  if (
    message.type !== 'BOARD_PAGE_COLLECTED' ||
    typeof message.requestId !== 'string' ||
    typeof message.page !== 'number' ||
    !Number.isSafeInteger(message.page) ||
    message.page < 1 ||
    typeof message.result !== 'object' ||
    message.result === null
  ) {
    return false
  }
  const result = message.result as { items?: unknown; pageInfo?: unknown; pageIdentity?: unknown }
  const pageInfo = result.pageInfo as { lastNavigationPageNumber?: unknown; visibleNextButton?: unknown; totalArticleCount?: unknown } | null
  return (
    Array.isArray(result.items) &&
    typeof result.pageIdentity === 'string' &&
    pageInfo !== null &&
    typeof pageInfo?.lastNavigationPageNumber === 'number' &&
    typeof pageInfo.visibleNextButton === 'boolean' &&
    (typeof pageInfo.totalArticleCount === 'number' || pageInfo.totalArticleCount === null)
  )
}

/** Runtime guard for the fixed, deliberately narrow member-list collection contract. */
export function isCollectMemberPageRequest(value: unknown): value is CollectMemberPageRequest {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<CollectMemberPageRequest>
  return (
    message.type === 'COLLECT_MEMBER_PAGE' &&
    typeof message.requestId === 'string' &&
    message.cafeId === CAFE_MEMBER_LIST.cafeId &&
    typeof message.page === 'number' &&
    Number.isSafeInteger(message.page) &&
    message.page >= 1 &&
    message.perPage === CAFE_MEMBER_LIST.perPage
  )
}

function isMemberPageCollected(value: unknown): value is Extract<ExtensionMessage, { type: 'MEMBER_PAGE_COLLECTED' }> {
  if (typeof value !== 'object' || value === null) return false
  const message = value as { type?: unknown; requestId?: unknown; page?: unknown; result?: unknown }
  if (
    message.type !== 'MEMBER_PAGE_COLLECTED' ||
    typeof message.requestId !== 'string' ||
    typeof message.page !== 'number' ||
    !Number.isSafeInteger(message.page) ||
    message.page < 1 ||
    typeof message.result !== 'object' ||
    message.result === null
  ) {
    return false
  }
  const result = message.result as { items?: unknown; pageIdentity?: unknown }
  return Array.isArray(result.items) && typeof result.pageIdentity === 'string'
}
