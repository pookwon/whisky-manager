import { KST_OFFSET_MS } from '../shared/kst.js'
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
  FUTURE_DAY: 'warn',
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

/**
 * Roughly how long a run of `count` comments takes, in whole minutes. The
 * operator is deciding whether to start something that may hold the tool for
 * the rest of the hour, so the useful answer is the order of magnitude.
 */
export function estimatedMinutes(count: number, averageActionGapMs: number): number {
  return Math.max(1, Math.round((count * averageActionGapMs) / 60_000))
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
    // A separate key rather than one string with optional parts: i18next
    // interpolates variables and nothing else, so anything conditional has to
    // be a choice between keys, the way the walks below do it.
    const { pagesRead, collected } = progress
    return pagesRead === undefined || collected === undefined
      ? { key: 'progress.collecting', values: {} }
      : { key: 'progress.collectingCounted', values: { pages: pagesRead, count: collected } }
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
 * The next session as HH:MM on the cafe's clock, or null when none is due.
 *
 * KST, never the machine's zone and never UTC. The operator compares this
 * against the wall clock beside them; nine hours out reads as "idle until
 * morning" when the next run is a minute away. Shifting the instant and then
 * reading the UTC fields keeps the arithmetic independent of where the machine
 * happens to be set.
 */
export function formatNextSessionTime(nextSessionAt: number | null): string | null {
  if (nextSessionAt === null) return null

  const kst = new Date(nextSessionAt + KST_OFFSET_MS)
  const hours = String(kst.getUTCHours()).padStart(2, '0')
  const minutes = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * The palette role a bridge status wears. Shared rather than spelled out at each
 * call site, so the sidebar and the dashboard cannot end up telling the operator
 * two different things about one socket.
 *
 * OFFLINE is idle, not alarm: an extension that is not there is an absence, and
 * the window already reserves its alarm colour for something going wrong.
 */
export function getBridgeStatusTone(status: BridgeStatus): 'ok' | 'warn' | 'idle' {
  switch (status) {
    case 'CONNECTED':
      return 'ok'
    case 'RECONNECTING':
      return 'warn'
    case 'OFFLINE':
      return 'idle'
  }
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
