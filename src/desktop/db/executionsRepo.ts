import { and, count, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import {
  UNRESOLVED_STATUSES,
  type ExecutionStatus,
  type ExecutionStrategy,
  type RiskFlag,
} from '../../shared/types.js'
import type { AppDatabase } from './client.js'
import { executions } from './schema.js'

export interface ExecutionPatch {
  readonly status: ExecutionStatus
  readonly strategy?: ExecutionStrategy | null
  readonly reason?: string | null
  readonly riskFlags?: readonly RiskFlag[]
  readonly templateId?: string | null
  readonly renderedText?: string | null
  readonly actorAccount?: string | null
  readonly attempts?: number
  readonly executedAt?: number | null
  readonly resolvedAt?: number | null
}

export interface ExecutionRow {
  readonly id: string
  readonly automationId: string
  readonly targetPostId: string
  readonly targetPostedAt: number
  readonly status: ExecutionStatus
  readonly strategy: ExecutionStrategy | null
  readonly reason: string | null
  readonly riskFlags: RiskFlag[]
  readonly attempts: number
  readonly executedAt: number | null
  readonly resolvedAt: number | null
}

export interface UnresolvedRow {
  readonly id: string
  readonly targetPostId: string
  readonly targetPostedAt: number
  readonly status: ExecutionStatus
  readonly attempts: number
  /** Approval expiry is measured from detection, not from the post's date. */
  readonly detectedAt: number
}

export interface AwaitingDetailRow {
  readonly id: string
  readonly targetPostId: string
  readonly targetTitle: string | null
  readonly targetAuthor: string | null
  readonly renderedText: string | null
  readonly riskFlags: RiskFlag[]
  readonly detectedAt: number
}

export interface QueuedRow {
  readonly id: string
  readonly cafeId: string
  readonly boardId: string
  readonly targetPostId: string
  readonly targetAuthor: string | null
  readonly renderedText: string
  readonly templateId: string | null
  readonly attempts: number
}

export interface ExecutionsRepo {
  applyPatch(id: string, patch: ExecutionPatch): void
  /**
   * Both counts are taken over the day a post belongs to, not the clock time
   * the work happened. Filling in an earlier day happens today, but it is not
   * today's work and must not spend today's allowance or show in today's
   * figures. In normal operation the two readings agree, because only the
   * current day's posts are ever targets.
   */
  countByStatusForDay(
    automationId: string,
    status: ExecutionStatus,
    dayStartMs: number,
    dayEndMs: number,
  ): number
  countExecutedForDay(automationId: string, dayStartMs: number, dayEndMs: number): number
  countExecutedSince(automationId: string, sinceMs: number): number
  listUnresolved(automationId: string): UnresolvedRow[]
  listByStatus(automationId: string, status: ExecutionStatus): UnresolvedRow[]
  listQueued(automationId: string): QueuedRow[]
  countByStatus(automationId: string, status: ExecutionStatus): number
  listAwaitingDetail(automationId: string): AwaitingDetailRow[]
  getById(id: string): ExecutionRow | undefined
}

function parseFlags(raw: string): RiskFlag[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RiskFlag[]) : []
  } catch {
    return []
  }
}

interface RawRow {
  id: string
  targetPostId: string
  targetPostedAt: number
  status: ExecutionStatus
  attempts: number
  detectedAt: number
}

function toUnresolvedRow(r: RawRow): UnresolvedRow {
  return {
    id: r.id,
    targetPostId: r.targetPostId,
    targetPostedAt: r.targetPostedAt,
    status: r.status,
    attempts: r.attempts,
    detectedAt: r.detectedAt,
  }
}

export function createExecutionsRepo(db: AppDatabase): ExecutionsRepo {
  return {
    applyPatch(id, patch) {
      const values: Record<string, unknown> = { status: patch.status }
      if (patch.strategy !== undefined) values.strategy = patch.strategy
      if (patch.reason !== undefined) values.reason = patch.reason
      if (patch.riskFlags !== undefined) values.riskFlags = JSON.stringify(patch.riskFlags)
      if (patch.templateId !== undefined) values.templateId = patch.templateId
      if (patch.renderedText !== undefined) values.renderedText = patch.renderedText
      if (patch.actorAccount !== undefined) values.actorAccount = patch.actorAccount
      if (patch.attempts !== undefined) values.attempts = patch.attempts
      if (patch.executedAt !== undefined) values.executedAt = patch.executedAt
      if (patch.resolvedAt !== undefined) values.resolvedAt = patch.resolvedAt

      db.update(executions).set(values).where(eq(executions.id, id)).run()
    },

    countByStatusForDay(automationId, status, dayStartMs, dayEndMs) {
      return (
        db
          .select({ value: count() })
          .from(executions)
          .where(
            and(
              eq(executions.automationId, automationId),
              eq(executions.status, status),
              gte(executions.targetPostedAt, dayStartMs),
              lt(executions.targetPostedAt, dayEndMs),
            ),
          )
          .get()?.value ?? 0
      )
    },

    countExecutedSince(automationId, sinceMs) {
      // Counted by when the request went out rather than by the day of the post
      // it answered: this is what the cafe saw in that stretch of clock time,
      // and filling in an earlier day is traffic like any other.
      return (
        db
          .select({ value: count() })
          .from(executions)
          .where(
            and(
              eq(executions.automationId, automationId),
              isNotNull(executions.executedAt),
              gte(executions.executedAt, sinceMs),
            ),
          )
          .get()?.value ?? 0
      )
    },

    countExecutedForDay(automationId, dayStartMs, dayEndMs) {
      // Every row we actually sent to naver, whatever the outcome. Volume caps
      // guard request count, so a failed attempt still consumed the budget.
      return (
        db
          .select({ value: count() })
          .from(executions)
          .where(
            and(
              eq(executions.automationId, automationId),
              isNotNull(executions.executedAt),
              gte(executions.targetPostedAt, dayStartMs),
              lt(executions.targetPostedAt, dayEndMs),
            ),
          )
          .get()?.value ?? 0
      )
    },

    listUnresolved(automationId) {
      return db
        .select()
        .from(executions)
        .where(
          and(eq(executions.automationId, automationId), inArray(executions.status, [...UNRESOLVED_STATUSES])),
        )
        .all()
        .map(toUnresolvedRow)
    },

    listByStatus(automationId, status) {
      return db
        .select()
        .from(executions)
        .where(and(eq(executions.automationId, automationId), eq(executions.status, status)))
        .all()
        .map(toUnresolvedRow)
    },

    listQueued(automationId) {
      return db
        .select()
        .from(executions)
        .where(and(eq(executions.automationId, automationId), eq(executions.status, 'QUEUED')))
        .all()
        .flatMap((r) =>
          // A queued row with no text yet belongs to the session that claimed
          // it; that session renders and executes it in the same pass.
          r.renderedText === null
            ? []
            : [
                {
                  id: r.id,
                  cafeId: r.cafeId,
                  boardId: r.boardId,
                  targetPostId: r.targetPostId,
                  targetAuthor: r.targetAuthor,
                  renderedText: r.renderedText,
                  templateId: r.templateId,
                  attempts: r.attempts,
                },
              ],
        )
    },

    countByStatus(automationId, status) {
      return (
        db
          .select({ value: count() })
          .from(executions)
          .where(and(eq(executions.automationId, automationId), eq(executions.status, status)))
          .get()?.value ?? 0
      )
    },

    listAwaitingDetail(automationId) {
      return db
        .select()
        .from(executions)
        .where(
          and(eq(executions.automationId, automationId), eq(executions.status, 'AWAITING_APPROVAL')),
        )
        .all()
        .map((r) => ({
          id: r.id,
          targetPostId: r.targetPostId,
          targetTitle: r.targetTitle,
          targetAuthor: r.targetAuthor,
          renderedText: r.renderedText,
          riskFlags: parseFlags(r.riskFlags),
          detectedAt: r.detectedAt,
        }))
    },

    getById(id) {
      const r = db.select().from(executions).where(eq(executions.id, id)).get()
      if (r === undefined) return undefined
      return {
        id: r.id,
        automationId: r.automationId,
        targetPostId: r.targetPostId,
        targetPostedAt: r.targetPostedAt,
        status: r.status,
        strategy: r.strategy,
        reason: r.reason,
        riskFlags: parseFlags(r.riskFlags),
        attempts: r.attempts,
        executedAt: r.executedAt,
        resolvedAt: r.resolvedAt,
      }
    },
  }
}
