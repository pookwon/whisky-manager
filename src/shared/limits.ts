import type { GateBlockReason, Limits, RunMode } from './types.js'

/** The stretch of clock time the hourly cap is measured over. */
export const RATE_WINDOW_MS = 3_600_000

export interface GateContext {
  readonly killed: boolean
  /** Requests sent to the cafe in the last hour, this session's and earlier. */
  readonly hourlyCount: number
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
  // What makes the tool conspicuous is how much it does inside an hour rather
  // than how much it does in a day, so the volume gate is drawn there. A forced
  // run still steps over it: the cap is what steady operation looks like, not a
  // line that must never be crossed.
  if (mode !== 'FORCED' && ctx.hourlyCount >= limits.hourlyCap) {
    return { allowed: false, reason: 'HOURLY_CAP_REACHED' }
  }
  if (mode === 'SCHEDULED' && ctx.sessionCount >= limits.perSessionCap) {
    return { allowed: false, reason: 'SESSION_CAP_REACHED' }
  }
  return { allowed: true }
}

/**
 * The brake watches age, not volume. A large backlog that arrived overnight is
 * ordinary on a busy board; a backlog holding days-old posts means something is
 * broken.
 */
export function hasStaleBacklog(
  unresolved: readonly { postedAt: number }[],
  nowMs: number,
  limits: Limits,
): boolean {
  return unresolved.some((item) => nowMs - item.postedAt > limits.backlogMaxAgeMs)
}
