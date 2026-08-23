import type { SessionOutcome, SessionProgress, SessionRefusal } from '../desktop/orchestrator.js'
import type { BridgeStatus } from '../desktop/ipc.js'

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

export interface ProgressSummary {
  readonly key: string
  readonly values: Record<string, string | number>
}

/**
 * Returns an i18n key and its values, as `outcomeSummary` does, so the wording
 * stays in the locale file. The post in hand counts as the current position
 * rather than waiting to be finished: an operator reads "1/3" as the first of
 * three being worked on, not as one already done.
 */
export function progressSummary(progress: SessionProgress): ProgressSummary {
  if (progress.phase === 'COLLECTING') {
    return { key: `progress.${progress.phase}`, values: {} }
  }
  // Named separately so the operator can tell a backlog being cleared from
  // today's own posts; the two carry different totals.
  const walk = progress.phase === 'BACKLOG' ? 'backlog' : 'working'
  const values = { position: progress.done + 1, total: progress.total }
  return progress.nickname === null
    ? { key: `progress.${walk}`, values }
    : { key: `progress.${walk}On`, values: { ...values, nickname: progress.nickname } }
}

/**
 * Checks if a refusal is contradicted by current automation state.
 * A DISABLED refusal is stale if the automation is now enabled.
 */
export function isRefusalStale(outcome: SessionOutcome | null, automationEnabled: boolean): boolean {
  if (outcome === null) return false
  if (outcome.opened) return false
  if (outcome.reason !== 'DISABLED') return false
  return automationEnabled
}

/**
 * Formats the next session time as HH:MM, or returns null if not scheduled.
 * Assumes nextSessionAt is an absolute timestamp in milliseconds.
 */
export function formatNextSessionTime(nextSessionAt: number | null): string | null {
  if (nextSessionAt === null) return null

  const date = new Date(nextSessionAt)
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Returns the i18n key for the bridge status.
 */
export function getBridgeStatusKey(status: BridgeStatus): string {
  switch (status) {
    case 'CONNECTED':
      return 'status.bridgeConnected'
    case 'RECONNECTING':
      return 'status.bridgeReconnecting'
    case 'OFFLINE':
      return 'status.bridgeOffline'
  }
}
