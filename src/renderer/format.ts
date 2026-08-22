import type { SessionOutcome, SessionRefusal } from '../desktop/orchestrator.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export interface RelativeTime {
  readonly key: 'time.justNow' | 'time.minutesAgo' | 'time.hoursAgo' | 'time.daysAgo'
  readonly count: number
}

/** Returns an i18n key and count so the component owns the wording. */
export function relativeTime(fromMs: number, nowMs: number): RelativeTime {
  const age = Math.max(0, nowMs - fromMs)
  if (age < MINUTE) return { key: 'time.justNow', count: 0 }
  if (age < HOUR) return { key: 'time.minutesAgo', count: Math.floor(age / MINUTE) }
  if (age < DAY) return { key: 'time.hoursAgo', count: Math.floor(age / HOUR) }
  return { key: 'time.daysAgo', count: Math.floor(age / DAY) }
}

export type Tone = 'ok' | 'idle' | 'warn' | 'alarm'

export interface OutcomeSummary {
  readonly tone: Tone
  readonly key: string
  readonly count?: number
}

/**
 * A refusal is not automatically a problem. Being outside the operating window
 * is the system working; being logged out needs someone right now.
 */
const REFUSAL_TONE: Record<SessionRefusal, Tone> = {
  KILLED: 'warn',
  DISABLED: 'idle',
  NO_TEMPLATE: 'warn',
  OUTSIDE_ACTIVE_HOURS: 'idle',
  NOT_LOGGED_IN: 'alarm',
  LOGIN_CHECK_FAILED: 'warn',
  STALE_BACKLOG: 'alarm',
  COLLECT_FAILED: 'warn',
}

export function outcomeSummary(outcome: SessionOutcome | null): OutcomeSummary {
  if (outcome === null) return { tone: 'idle', key: 'outcome.never' }

  if (!outcome.opened) {
    return { tone: REFUSAL_TONE[outcome.reason], key: `outcome.refused.${outcome.reason}` }
  }

  if (outcome.failed > 0) {
    return { tone: 'alarm', key: 'outcome.ranWithFailures', count: outcome.failed }
  }
  return { tone: 'ok', key: 'outcome.ran', count: outcome.executed }
}
