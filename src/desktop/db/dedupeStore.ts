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
   * Atomically takes ownership of a post. Returns the execution id (new or revived),
   * or null if the post is terminal or already in progress.
   *
   * Claiming means "we handle this post", not "we finished it". Approval,
   * execution and retries are all status transitions on the row this creates —
   * retries never call claim again.
   *
   * If an earlier run started but did not finish this post, that row may be
   * revived: its state is reset to the initial state (AWAITING_APPROVAL, reason
   * null, risk flags empty, resolved timestamp cleared, attempts zeroed). The
   * caller's current post details win (title, author, timestamp). Returns the
   * revived row's id.
   *
   * Terminal rows (SUCCESS, FAILED) are never touched: they represent finished
   * work and their state must persist. In-progress rows (QUEUED, RETRY_WAIT,
   * AWAITING_APPROVAL) are left for their own handlers to manage.
   */
  claim(input: ClaimInput): Promise<string | null>
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export function createSqliteDedupeStore(db: AppDatabase, newId: () => string): DedupeStore {
  return {
    async claim(input: ClaimInput): Promise<string | null> {
      try {
        const claimed = db.transaction((tx) => {
          const existing = tx
            .select({ id: executions.id, status: executions.status })
            .from(executions)
            .where(
              and(
                eq(executions.cafeId, input.cafeId),
                eq(executions.automationId, input.automationId),
                eq(executions.targetPostId, input.postId),
              ),
            )
            .get()

          if (existing !== undefined) {
            // Rows whose work is done stay untouched. A successful post is not
            // re-judged even if a human later deletes our comment—that was their
            // choice. A post we abandoned after maxAttempts tries should not
            // restart on its own and hammer the API again.
            const TERMINAL: readonly typeof existing.status[] = ['SUCCESS', 'FAILED']
            if (TERMINAL.includes(existing.status)) return null

            // Rows that are in progress must be left to their handlers. They have
            // their own channels: a queued row will be promoted by retry logic, an
            // approval request will expire or be approved by humans.
            const IN_PROGRESS: readonly typeof existing.status[] = ['QUEUED', 'RETRY_WAIT', 'AWAITING_APPROVAL']
            if (IN_PROGRESS.includes(existing.status)) return null

            // The row is revivable (SKIPPED, EXPIRED, CANCELLED). Reset it as if
            // newly created but preserve the row id so the orchestrator's patch calls
            // still work. The caller's current values (title, author, timestamp) win.
            tx.update(executions)
              .set({
                targetTitle: input.title,
                targetAuthor: input.authorNickname,
                targetAuthorId: input.authorId,
                targetPostedAt: input.postedAt,
                detectedAt: input.detectedAt,
                status: 'AWAITING_APPROVAL',
                strategy: null,
                riskFlags: '[]',
                reason: null,
                resolvedAt: null,
                attempts: 0,
              })
              .where(eq(executions.id, existing.id))
              .run()
            return existing.id
          }

          const id = newId()
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
