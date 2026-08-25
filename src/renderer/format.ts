import { KST_OFFSET_MS } from '../shared/kst.js'
import type { SessionOutcome, SessionProgress, SessionRefusal } from '../desktop/orchestrator.js'
import type { BridgeStatus } from '../desktop/ipc.js'
import type { WarmCheck } from '../desktop/sessionWarmer.js'
import { TEXT } from '../shared/text.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** How long ago something happened, in the words the operator reads. */
export function relativeTime(fromMs: number, nowMs: number): string {
  const age = Math.max(0, nowMs - fromMs)
  if (age < MINUTE) return TEXT.time.justNow
  if (age < HOUR) return TEXT.time.minutesAgo(Math.floor(age / MINUTE))
  if (age < DAY) return TEXT.time.hoursAgo(Math.floor(age / HOUR))
  return TEXT.time.daysAgo(Math.floor(age / DAY))
}

export type Tone = 'ok' | 'idle' | 'warn' | 'alarm'

export interface OutcomeSummary {
  readonly tone: Tone
  readonly text: string
}

/**
 * A refusal is not automatically a problem. Being outside the operating window
 * is the system working; being logged out needs someone right now.
 */
const REFUSAL_TONE: Record<SessionRefusal, Tone> = {
  FUTURE_DAY: 'warn',
  NOT_CONFIGURED: 'warn',
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
  if (outcome === null) return { tone: 'idle', text: TEXT.outcome.never }

  if (!outcome.opened) {
    // Indexing by the reason is what keeps the two maps honest: a refusal added
    // to the union with no tone or no wording fails to compile here.
    return { tone: REFUSAL_TONE[outcome.reason], text: TEXT.outcome.refused[outcome.reason] }
  }

  if (outcome.failed > 0) {
    return { tone: 'alarm', text: TEXT.outcome.ranWithFailures(outcome.failed) }
  }
  return { tone: 'ok', text: TEXT.outcome.ran(outcome.executed) }
}

/**
 * Roughly how long a run of `count` comments takes, in whole minutes. The
 * operator is deciding whether to start something that may hold the tool for
 * the rest of the hour, so the useful answer is the order of magnitude.
 */
export function estimatedMinutes(count: number, averageActionGapMs: number): number {
  return Math.max(1, Math.round((count * averageActionGapMs) / 60_000))
}

/**
 * What the session in flight is doing, in words. The post in hand counts as the
 * current position rather than waiting to be finished: an operator reads "1/3"
 * as the first of three being worked on, not as one already done.
 */
export function progressSummary(progress: SessionProgress): string {
  if (progress.phase === 'COLLECTING') {
    const { pagesRead, collected } = progress
    return pagesRead === undefined || collected === undefined
      ? TEXT.progress.collecting
      : TEXT.progress.collectingCounted(pagesRead, collected)
  }

  const position = progress.done + 1
  const { total, nickname } = progress

  // Backlog and today's own posts are named apart because they carry different
  // totals, and an operator who cannot tell them apart reads the count as wrong.
  if (progress.phase === 'BACKLOG') {
    return nickname === null
      ? TEXT.progress.backlog(position, total)
      : TEXT.progress.backlogOn(position, total, nickname)
  }
  return nickname === null
    ? TEXT.progress.working(position, total)
    : TEXT.progress.workingOn(position, total, nickname)
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
 * An instant as HH:MM on the cafe's clock.
 *
 * KST, never the machine's zone and never UTC. The operator compares this
 * against the wall clock beside them; nine hours out reads as "idle until
 * morning" when the next run is a minute away. Shifting the instant and then
 * reading the UTC fields keeps the arithmetic independent of where the machine
 * happens to be set.
 */
export function formatKstTime(epochMs: number): string {
  const kst = new Date(epochMs + KST_OFFSET_MS)
  const hours = String(kst.getUTCHours()).padStart(2, '0')
  const minutes = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * What the dashboard says about the reads that keep the browser's login in use.
 *
 * Silence would be indistinguishable from the feature not existing, so this
 * always says something while the loop runs — including before the first read
 * lands, which is a real state and about an hour long.
 */
export function warmSummary(lastWarm: WarmCheck | null): string {
  if (lastWarm === null) return TEXT.time.sessionUnchecked
  const time = formatKstTime(lastWarm.at)
  return lastWarm.loggedIn ? TEXT.time.sessionKeptAlive(time) : TEXT.time.sessionLapsed(time)
}

/** The next session on that same clock, or null when none is due. */
export function formatNextSessionTime(nextSessionAt: number | null): string | null {
  return nextSessionAt === null ? null : formatKstTime(nextSessionAt)
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

/** What the bridge status is called on screen. */
export function getBridgeStatusText(status: BridgeStatus): string {
  switch (status) {
    case 'CONNECTED':
      return TEXT.status.bridgeConnected
    case 'RECONNECTING':
      return TEXT.status.bridgeReconnecting
    case 'OFFLINE':
      return TEXT.status.bridgeOffline
  }
}
