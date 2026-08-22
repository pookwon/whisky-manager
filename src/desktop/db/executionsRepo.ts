import { and, eq, gte, inArray } from 'drizzle-orm'
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
}

export interface ExecutionsRepo {
  applyPatch(id: string, patch: ExecutionPatch): void
  countSuccessSince(automationId: string, sinceMs: number): number
  listUnresolved(automationId: string): UnresolvedRow[]
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

    countSuccessSince(automationId, sinceMs) {
      return db
        .select()
        .from(executions)
        .where(
          and(
            eq(executions.automationId, automationId),
            eq(executions.status, 'SUCCESS'),
            gte(executions.resolvedAt, sinceMs),
          ),
        )
        .all().length
    },

    listUnresolved(automationId) {
      return db
        .select()
        .from(executions)
        .where(
          and(eq(executions.automationId, automationId), inArray(executions.status, [...UNRESOLVED_STATUSES])),
        )
        .all()
        .map((r) => ({
          id: r.id,
          targetPostId: r.targetPostId,
          targetPostedAt: r.targetPostedAt,
          status: r.status,
          attempts: r.attempts,
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
