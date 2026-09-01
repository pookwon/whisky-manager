import { KST_OFFSET_MS } from '../shared/kst.js'
import type { SessionOutcome, SessionProgress, SessionRefusal } from '../desktop/orchestrator.js'
import type { AutomationStatus, BridgeStatus } from '../desktop/ipc.js'
import type { WarmCheck } from '../desktop/sessionWarmer.js'
import { TEXT } from '../shared/text.js'
import { findAutomation } from '../shared/automations/catalog.js'

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

/**
 * Recovery is for an extension that used to exist and is now genuinely gone.
 * The reconnecting grace period covers normal MV3 worker sleep, while an
 * install that never paired belongs to the first-run guide instead.
 */
export function shouldOfferExtensionRecovery(
  bridgeStatus: BridgeStatus,
  extensionEverPaired: boolean | undefined,
): boolean {
  return bridgeStatus === 'OFFLINE' && extensionEverPaired === true
}

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
 * What is switched off, named, for the banner that says nothing can run.
 *
 * Empty means everything is on and the banner does not belong on the screen.
 * An id the catalogue does not know still gets named — as itself — because an
 * automation that cannot run and cannot be named is the worst of both.
 */
export function disabledAutomationNames(
  automations: readonly Pick<AutomationStatus, 'id' | 'enabled'>[],
): string[] {
  return automations
    .filter((automation) => !automation.enabled)
    .map((automation) => {
      const descriptor = findAutomation(automation.id)
      return descriptor === undefined ? automation.id : TEXT.automation[descriptor.labelKey]
    })
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
 * How long something still going has been going — `22분째`, `1시간 5분째`.
 *
 * `relativeTime` is past tense by construction: it answers when something
 * happened. Used on a block that has not ended it produces "22분 전 진행 중",
 * which reads as a block that started and stopped twenty-two minutes ago.
 */
export function elapsedLabel(fromMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.floor(Math.max(0, nowMs - fromMs) / MINUTE))
  if (minutes < 60) return TEXT.time.minutesInto(minutes)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? TEXT.time.hoursInto(hours) : TEXT.time.hoursMinutesInto(hours, rest)
}

/**
 * The hour of the day on the cafe's clock, 0–23.
 *
 * Same shifted-then-read-UTC trick as `formatKstTime`, and here for the same
 * reason: the screen decides whether an operating window is open by comparing
 * this against hours that were written in KST.
 */
export function kstHourOf(epochMs: number): number {
  return new Date(epochMs + KST_OFFSET_MS).getUTCHours()
}

/**
 * An operating window as the operator reads it — `08~24시`.
 *
 * The end hour is exclusive everywhere it is stored, and it is named directly
 * here anyway: `08~23시` would be read as closing an hour early, where `24시`
 * is how a person says midnight.
 */
export function activeWindowLabel(startHour: number, endHour: number): string {
  const pad = (hour: number): string => String(hour).padStart(2, '0')
  return `${pad(startHour)}~${pad(endHour)}시`
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

/**
 * `MM-DD HH:MM` on the cafe's clock. A collected span runs over days, so the
 * hour alone would leave the operator guessing which day they are looking at.
 */
export function formatKstDateTime(epochMs: number): string {
  const kst = new Date(epochMs + KST_OFFSET_MS)
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(kst.getUTCDate()).padStart(2, '0')
  return `${month}-${day} ${formatKstTime(epochMs)}`
}

/**
 * `YYYY-MM-DD` on the cafe's clock. A target period is picked in whole days and
 * can reach years back, so the year is part of naming it.
 */
export function formatKstDate(epochMs: number): string {
  const kst = new Date(epochMs + KST_OFFSET_MS)
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(kst.getUTCDate()).padStart(2, '0')
  return `${kst.getUTCFullYear()}-${month}-${day}`
}

/**
 * The range a run was asked for, in the unit it was asked in. Under a day the
 * operator thinks in hours, and "최근 0일" says nothing.
 */
export function collectionRangeLabel(run: {
  readonly targetStartMs: number
  readonly targetEndMs: number
}): string {
  const span = Math.max(0, run.targetEndMs - run.targetStartMs)
  return span >= DAY
    ? TEXT.collection.targetRange(Math.round(span / DAY))
    : TEXT.collection.targetHours(Math.max(1, Math.round(span / HOUR)))
}

/**
 * How far into its target range a run has walked, as a percentage.
 *
 * Measured from the cursor's own posted time rather than from page counts: the
 * feed shifts under the reader, so a page number is not a position, while the
 * time of the last committed post is exactly one. Null until the first page is
 * committed, which is a real state and not zero progress.
 */
export function collectionCoveragePercent(run: {
  readonly targetStartMs: number
  readonly targetEndMs: number
  readonly cursorPostedAtMs: number | null
}): number | null {
  if (run.cursorPostedAtMs === null) return null
  const span = run.targetEndMs - run.targetStartMs
  if (span <= 0) return null
  const walked = run.targetEndMs - run.cursorPostedAtMs
  return Math.min(100, Math.max(0, Math.round((walked / span) * 100)))
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
