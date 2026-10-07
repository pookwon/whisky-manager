import { PREFIX_REMINDER_AUTOMATION_ID, WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'
import type {
  AppMessage,
  CollectArticleRequest,
  CollectBoardPageRequest,
  CollectBoardSearchPageRequest,
  CollectMemberPageRequest,
  ExtensionMessage,
  SourceRef,
} from '../shared/protocol.js'
import type { CommentAuthor } from '../shared/types.js'
import type { BoardPageReadResult } from './boardPageReader.js'
import type { BoardSearchPageReadResult } from './boardSearchPageReader.js'
import type { ArticleReadResult } from './articleReader.js'
import type { Reply } from './bridgeClient.js'
import type { CafeClient, ExecuteResult } from './cafeClient.js'
import type { MemberPageReadResult } from './memberPageReader.js'

/** What an automation needs to be able to do to comment on a post. */
export interface CommentClient {
  checkComments(source: SourceRef, postId: string): Promise<CommentAuthor[] | null>
  execute(source: SourceRef, postId: string, content: string): Promise<ExecuteResult>
}

export type CollectionProgress = (pagesRead: number, collected: number) => void

export interface DispatcherDeps {
  readonly cafe: CafeClient
  readonly articleCafe: CommentClient
  readonly boardPageReader: { read(request: CollectBoardPageRequest): Promise<BoardPageReadResult> }
  readonly boardSearchPageReader: { read(request: CollectBoardSearchPageRequest): Promise<BoardSearchPageReadResult> }
  readonly articleReader: { read(request: CollectArticleRequest): Promise<ArticleReadResult> }
  readonly memberPageReader: { read(request: CollectMemberPageRequest): Promise<MemberPageReadResult> }
  readonly probe: (requestId: string, url: string, reply: Reply) => Promise<void>
  /** The socket belongs to the assembly, so closing it does too. */
  readonly onHandshakeRejected: (reason: string | null) => void
  /** Installs the listener the cafe client reports collection progress to. */
  readonly setCollectionProgress: (listener: CollectionProgress | null) => void
}

/**
 * The extension decides nothing. Each of these runs one instruction from the
 * app and reports what happened, so a torn-down service worker loses no state.
 *
 * It lives apart from `background.ts` because that file cannot be loaded
 * outside a service worker — it dials a socket and registers Chrome listeners
 * on import — and routing an instruction to the wrong automation is exactly the
 * kind of mistake worth a test.
 */
export function createDispatcher(deps: DispatcherDeps) {
  /**
   * Which client answers for which automation. Two automations comment on two
   * different surfaces — a memo board and an ordinary article — with different
   * hosts, encodings and success checks. An id nobody registered is refused
   * rather than guessed: answering with the wrong board's client would post the
   * comment somewhere nobody asked for.
   */
  const commentClients: Record<string, CommentClient> = {
    [WELCOME_AUTOMATION_ID]: deps.cafe,
    [PREFIX_REMINDER_AUTOMATION_ID]: deps.articleCafe,
  }

  return async function dispatch(message: AppMessage, reply: Reply): Promise<void> {
    switch (message.type) {
      case 'HELLO_ACK':
        if (!message.accepted) deps.onHandshakeRejected(message.reason)
        return

      case 'CHECK_LOGIN': {
        const state = await deps.cafe.checkLogin(message.source)
        reply({
          type: 'LOGIN_STATE',
          requestId: message.requestId,
          loggedIn: state.loggedIn,
          account: state.account,
        })
        return
      }

      case 'COLLECT': {
        deps.setCollectionProgress((pagesRead, collected) => {
          const progressMessage: ExtensionMessage = {
            type: 'COLLECT_PROGRESS',
            requestId: message.requestId,
            pagesRead,
            collected,
          }
          reply(progressMessage)
        })
        try {
          const candidates = await deps.cafe.collect(message.source, message.sincePostedAt)
          reply({ type: 'COLLECTED', requestId: message.requestId, candidates })
        } finally {
          deps.setCollectionProgress(null)
        }
        return
      }

      case 'COLLECT_BOARD_PAGE': {
        const result = await deps.boardPageReader.read(message)
        if (!result.ok) {
          // Codes are deliberately stable and body-free: a list response can
          // contain account-linked data and must never be echoed to the bridge.
          // The detail names only the parser rule a page broke and where.
          reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.detail ?? result.code })
          return
        }
        reply({ type: 'BOARD_PAGE_COLLECTED', requestId: message.requestId, page: result.page, result: result.result })
        return
      }

      case 'COLLECT_BOARD_SEARCH_PAGE': {
        const result = await deps.boardSearchPageReader.read(message)
        if (!result.ok) {
          // Stable and body-free, like the list: a search response names members.
          // The detail names only the parser rule a page broke and where.
          reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.detail ?? result.code })
          return
        }
        reply({ type: 'BOARD_PAGE_COLLECTED', requestId: message.requestId, page: result.page, result: result.result })
        return
      }

      case 'COLLECT_ARTICLE': {
        const result = await deps.articleReader.read(message)
        if (!result.ok) {
          // Stable and body-free, like the pages: an article names its writer.
          // The detail names only the parser rule an article broke and where.
          reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.detail ?? result.code })
          return
        }
        reply({ type: 'ARTICLE_COLLECTED', requestId: message.requestId, result: result.result })
        return
      }

      case 'COLLECT_MEMBER_PAGE': {
        const result = await deps.memberPageReader.read(message)
        if (!result.ok) {
          // Codes are deliberately stable and body-free: a member list response
          // contains member keys and nicknames and must never reach the bridge.
          reply({ type: 'ERROR', requestId: message.requestId, code: result.code, message: result.code })
          return
        }
        reply({ type: 'MEMBER_PAGE_COLLECTED', requestId: message.requestId, page: result.page, result: result.result })
        return
      }

      case 'CHECK_COMMENTS': {
        const client = commentClients[message.automationId]
        if (client === undefined) {
          reply({ type: 'ERROR', requestId: message.requestId, code: 'UNKNOWN_AUTOMATION', message: message.automationId })
          return
        }
        const authors = await client.checkComments(
          { cafeId: message.action.cafeId, boardId: message.action.boardId },
          message.action.postId,
        )
        reply({ type: 'COMMENTS', requestId: message.requestId, authors })
        return
      }

      case 'EXECUTE': {
        const client = commentClients[message.automationId]
        if (client === undefined) {
          reply({ type: 'ERROR', requestId: message.requestId, code: 'UNKNOWN_AUTOMATION', message: message.automationId })
          return
        }
        const { cafeId, boardId, postId, body } = message.action
        const result = await client.execute({ cafeId, boardId }, postId, body)
        reply({
          type: 'EXECUTED',
          requestId: message.requestId,
          ok: result.ok,
          strategy: 'FETCH',
          commentAuthors: result.commentAuthors,
          error: result.error,
          diagnostic: result.diagnostic,
        })
        return
      }

      case 'PROBE':
        await deps.probe(message.requestId, message.url, reply)
        return

      case 'ABORT':
        return
    }
  }
}
