import type { Candidate, CommentAuthor, RiskFlag, SkipReason } from './types.js'

export type GuardOutcome =
  | { kind: 'RISK'; flag: RiskFlag }
  | { kind: 'SKIP'; reason: SkipReason }
  | null

export interface GuardContext {
  readonly nowMs: number
  /** Every account the cafe staff use, not just the executing one. */
  readonly operatorAccounts: readonly string[]
  /** Authors of comments already on the post. `null` means the check failed. */
  readonly existingCommentAuthors: readonly CommentAuthor[] | null
  /**
   * Whether this is the earliest post its author made in this collection.
   * Computed by the caller, which is the only place that sees the whole set.
   */
  readonly isFirstPostByAuthor: boolean
}

export type Guard = (candidate: Candidate, ctx: GuardContext) => GuardOutcome

export interface GuardEvaluation {
  readonly skip: SkipReason | null
  readonly flags: readonly RiskFlag[]
}

/**
 * A post any staff member already greeted is done, whichever account they used.
 * Checking only the executing account double-comments during parallel operation
 * with humans, which is exactly what the Phase 5 ramp-up looks like.
 */
export const operatorAlreadyCommentedGuard: Guard = (_candidate, ctx) => {
  if (ctx.existingCommentAuthors === null) {
    return { kind: 'RISK', flag: 'COMMENT_CHECK_FAILED' }
  }
  return containsOperator(ctx.existingCommentAuthors, ctx.operatorAccounts)
    ? { kind: 'SKIP', reason: 'ALREADY_COMMENTED' }
    : null
}

/**
 * An account is configured by nickname or by member key, and either matches.
 * The orchestrator re-runs this check right before executing, so it lives here
 * rather than being written out twice.
 */
export function containsOperator(
  authors: readonly CommentAuthor[],
  operatorAccounts: readonly string[],
): boolean {
  const operators = new Set(operatorAccounts)
  return authors.some((author) => operators.has(author.nickname) || operators.has(author.memberKey))
}

export function evaluateGuards(
  guards: readonly Guard[],
  candidate: Candidate,
  ctx: GuardContext,
): GuardEvaluation {
  const flags: RiskFlag[] = []
  for (const guard of guards) {
    const outcome = guard(candidate, ctx)
    if (outcome === null) continue
    if (outcome.kind === 'SKIP') {
      return { skip: outcome.reason, flags: [] }
    }
    flags.push(outcome.flag)
  }
  return { skip: null, flags }
}
