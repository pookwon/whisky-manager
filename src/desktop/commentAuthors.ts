import { nextCommentLookupDelayMs } from '../shared/schedule.js'
import type { Random } from '../shared/ports.js'
import { TIMEOUTS } from '../shared/protocol.js'
import type { CommentAuthor } from '../shared/types.js'
import type { ExtensionTransport } from './ws/server.js'

export interface CommentAuthorLookupDeps {
  readonly transport: ExtensionTransport
  readonly cafeId: string
  readonly boardId: string
  readonly automationId: string
  readonly newRequestId: () => string
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
}

export interface CommentAuthorLookup {
  /**
   * Who commented on a post, or `null` when that cannot be established.
   *
   * A count of zero is the board stating nobody has, which needs no request.
   * A null count is the list itself being unreadable, which a request would
   * not fix. Everything else is asked once and remembered, so a preview and
   * the run it precedes do not each pay for the same post.
   */
  resolve(postId: string, commentCount: number | null): Promise<CommentAuthor[] | null>
}

export function createCommentAuthorLookup(deps: CommentAuthorLookupDeps): CommentAuthorLookup {
  const known = new Map<string, CommentAuthor[] | Promise<CommentAuthor[] | null>>()

  return {
    async resolve(postId, commentCount) {
      if (commentCount === null) return null
      if (commentCount === 0) return []

      const cached = known.get(postId)
      if (cached !== undefined) {
        if (cached instanceof Promise) {
          return await cached
        }
        return cached
      }

      // The work below runs as far as its first await and then parks, so the
      // promise is on the map before anything else can look. A second caller
      // arriving mid-flight waits on this one instead of asking again.
      const promise = (async () => {
        await deps.sleep(nextCommentLookupDelayMs(deps.random))

        try {
          const reply = await deps.transport.request(
            {
              type: 'CHECK_COMMENTS',
              requestId: deps.newRequestId(),
              automationId: deps.automationId,
              action: { cafeId: deps.cafeId, boardId: deps.boardId, postId },
            },
            TIMEOUTS.commentCheckMs,
          )
          if (reply.type !== 'COMMENTS' || reply.authors === null) {
            // Failure: clear the cache entry so the next ask retries. A failure
            // remembered would freeze a post out for as long as the app stays open.
            known.delete(postId)
            return null
          }
          // Success: replace promise with settled result for future asks
          known.set(postId, reply.authors)
          return reply.authors
        } catch {
          // Exception: clear the cache entry so the next ask retries
          known.delete(postId)
          return null
        }
      })()

      known.set(postId, promise)
      return promise
    },
  }
}
