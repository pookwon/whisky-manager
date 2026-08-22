export type ApprovalPolicy = 'AUTO' | 'SEMI' | 'MANUAL'

export type ExecutionStatus =
  | 'AWAITING_APPROVAL'
  | 'QUEUED'
  | 'RETRY_WAIT'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'EXPIRED'
  | 'CANCELLED'

/** Statuses that still owe work. The backlog brake counts only these. */
export const UNRESOLVED_STATUSES = ['AWAITING_APPROVAL', 'QUEUED', 'RETRY_WAIT'] as const

export type UnresolvedStatus = (typeof UNRESOLVED_STATUSES)[number]

export function isUnresolved(status: ExecutionStatus): status is UnresolvedStatus {
  return (UNRESOLVED_STATUSES as readonly string[]).includes(status)
}

export type RiskFlag =
  | 'VARIABLE_EXTRACTION_FAILED'
  | 'STRUCTURE_CHANGED'
  | 'ENDPOINT_MISMATCH'
  | 'COMMENT_CHECK_FAILED'

export type SkipReason = 'ALREADY_COMMENTED' | 'RISK_FLAGGED' | 'REJECTED_BY_OPERATOR'

export type GateBlockReason = 'KILLED' | 'DAILY_CAP_EXCEEDED' | 'SESSION_CAP_REACHED'

export type ExecutionStrategy = 'FETCH' | 'DOM'

export interface Candidate {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly title: string | null
  /**
   * Post body text. Needed because variable extraction may depend on it, and
   * because collecting it later would mean a second round of requests.
   */
  readonly bodyText: string | null
  readonly authorNickname: string | null
  readonly authorId: string | null
  /** Epoch milliseconds when the source post was written. */
  readonly postedAt: number
}

export interface Template {
  readonly id: string
  readonly body: string
}

export interface Limits {
  readonly sessionIntervalMinMs: number
  readonly sessionIntervalMaxMs: number
  readonly actionIntervalMinMs: number
  readonly actionIntervalMaxMs: number
  readonly perSessionCap: number
  readonly dailyCap: number
  /** Local hour the operating window opens, inclusive. */
  readonly activeHourStart: number
  /** Local hour the operating window closes, exclusive. 24 means midnight. */
  readonly activeHourEnd: number
  readonly weekendIntervalMultiplier: number
  readonly backlogMaxAgeMs: number
  readonly approvalTtlMs: number
  readonly maxAttempts: number
}

export type Profile = 'production' | 'debug'

/**
 * Who wrote a comment. Both identities travel together because operators are
 * configured by whichever one they know: a nickname is what staff recognise,
 * while the member key is what survives a rename.
 */
export interface CommentAuthor {
  readonly nickname: string
  readonly memberKey: string
}
