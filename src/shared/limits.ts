import type { Clock } from './ports.js'
import type { GateBlockReason, Limits } from './types.js'

export interface GateContext {
  readonly killed: boolean
  /** Executions already performed inside the current daily window. */
  readonly dailyCount: number
  /** Executions already performed inside the current session. */
  readonly sessionCount: number
}

export type GateVerdict = { allowed: true } | { allowed: false; reason: GateBlockReason }

export function checkGates(ctx: GateContext, limits: Limits): GateVerdict {
  if (ctx.killed) {
    return { allowed: false, reason: 'KILLED' }
  }
  if (ctx.dailyCount >= limits.dailyCap) {
    return { allowed: false, reason: 'DAILY_CAP_EXCEEDED' }
  }
  if (ctx.sessionCount >= limits.perSessionCap) {
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

/**
 * Daily counting is anchored to the operating window start, not midnight, so a
 * 23:00 execution and an 08:00 execution the next morning land on different
 * days the way an operator would expect.
 */
export function dailyWindowStart(epochMs: number, limits: Limits, clock: Clock): number {
  const { hour } = clock.parts(epochMs)
  if (hour >= limits.activeHourStart) {
    return clock.atHour(epochMs, limits.activeHourStart)
  }
  return clock.atHour(clock.addDays(epochMs, -1), limits.activeHourStart)
}
