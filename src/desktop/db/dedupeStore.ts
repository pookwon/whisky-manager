import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from './client.js'
import { executions } from './schema.js'

export interface ClaimInput {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly title: string | null
  readonly authorNickname: string | null
  readonly authorId: string | null
  readonly postedAt: number
  readonly detectedAt: number
}

export interface DedupeStore {
  /**
   * Atomically takes ownership of a post. Returns the new execution id, or null
   * if someone already owns it.
   *
   * Claiming means "we handle this post", not "we finished it". Approval,
   * execution and retries are all status transitions on the row this creates —
   * retries never call claim again.
   */
  claim(input: ClaimInput): Promise<string | null>
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export function createSqliteDedupeStore(db: AppDatabase, newId: () => string): DedupeStore {
  return {
    async claim(input: ClaimInput): Promise<string | null> {
      const id = newId()
      try {
        // One transaction so the author check and the insert cannot interleave.
        // The post id index still guards against the same post twice.
        const claimed = db.transaction((tx) => {
          if (input.authorId !== null) {
            const existing = tx
              .select({ id: executions.id })
              .from(executions)
              .where(
                and(
                  eq(executions.cafeId, input.cafeId),
                  eq(executions.automationId, input.automationId),
                  eq(executions.targetAuthorId, input.authorId),
                ),
              )
              .get()
            // Already greeted this member on another post of theirs.
            if (existing !== undefined) return null
          }
          tx.insert(executions)
            .values({
              id,
              automationId: input.automationId,
              cafeId: input.cafeId,
              boardId: input.boardId,
              targetPostId: input.postId,
              targetTitle: input.title,
              targetAuthor: input.authorNickname,
              targetAuthorId: input.authorId,
              targetPostedAt: input.postedAt,
              actorAccount: null,
              // Parked until the policy engine decides; the orchestrator moves it
              // to QUEUED or SKIPPED in the same session.
              status: 'AWAITING_APPROVAL',
              strategy: null,
              riskFlags: '[]',
              reason: null,
              templateId: null,
              renderedText: null,
              attempts: 0,
              detectedAt: input.detectedAt,
              executedAt: null,
              resolvedAt: null,
              deletedAt: null,
            })
            .run()
          return id
        })
        return claimed
      } catch (error) {
        if (isUniqueViolation(error)) return null
        throw error
      }
    },
  }
}
