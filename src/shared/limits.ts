import type { GateBlockReason, Limits, RunMode } from './types.js'

export interface GateContext {
  readonly killed: boolean
  /** Executions already performed inside the current daily window. */
  readonly dailyCount: number
  /** Executions already performed inside the current session. */
  readonly sessionCount: number
}

export type GateVerdict = { allowed: true } | { allowed: false; reason: GateBlockReason }

/**
 * The mode defaults to the strictest one: a caller that forgets to say who
 * asked must not end up with a session that may do more, only less.
 */
export function checkGates(
  ctx: GateContext,
  limits: Limits,
  mode: RunMode = 'SCHEDULED',
): GateVerdict {
  // Ahead of every cap, and answered the same way for every mode. It is the
  // only control that can stop a run already under way.
  if (ctx.killed) {
    return { allowed: false, reason: 'KILLED' }
  }
  if (mode !== 'FORCED' && ctx.dailyCount >= limits.dailyCap) {
    return { allowed: false, reason: 'DAILY_CAP_EXCEEDED' }
  }
  if (mode === 'SCHEDULED' && ctx.sessionCount >= limits.perSessionCap) {
    return { allowed: false, reason: 'SESSION_CAP_REACHED' }
  }
  return { allowed: true }
}

/**
 * The brake watches age, not volume. A large backlog that arrived overnight is
 * normal at 100~150 signups a day; a backlog holding days-old posts means
 * something is broken.
 */
export function hasStaleBacklog(
  unresolved: readonly { postedAt: number }[],
  nowMs: number,
  limits: Limits,
): boolean {
  return unresolved.some((item) => nowMs - item.postedAt > limits.backlogMaxAgeMs)
}
