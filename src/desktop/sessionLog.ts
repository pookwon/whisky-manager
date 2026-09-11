import { appendFileSync } from 'node:fs'
import type { EligibilityTally, Ineligibility } from '../shared/automations/prefix-reminder/eligibility.js'
import type { RunMode } from '../shared/types.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import { formatRefusalFields, stamp } from './refusalLog.js'
import type { WakeRecord } from './sessionLoop.js'

/**
 * What one day's walk read, and — for a collector that screens during
 * collection — why it dropped what it dropped. `tally` is null for a collector
 * that does not screen: the greeting reads a memo board where every post is a
 * candidate, so there is nothing to explain away.
 */
export interface DayReadSummary {
  readonly dayStartMs: number
  readonly pages: number
  readonly tally: EligibilityTally | null
  readonly read: number
}

export interface SessionRecord {
  readonly automationId: string
  readonly mode: RunMode
  readonly outcome: SessionOutcome
  readonly openedAt: number
  readonly endedAt: number
  readonly days: readonly DayReadSummary[]
  readonly wake: WakeRecord | null
}

/**
 * Fixed so a tally reads the same way twice, and the same order the collector
 * itself tries the reasons in.
 */
const DROPPED_ORDER: readonly Ineligibility[] = ['HAS_PREFIX', 'EXCLUDED_BOARD', 'AUTHOR_IS_OPERATOR']

/** `6m12s`, or just `40s` under a minute. Whole seconds; the gap between two greetings is not sub-second news. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`
}

function formatDaySummary(day: DayReadSummary): string {
  const parts = [`day=${stamp(day.dayStartMs).slice(5, 10)}`, `pages=${day.pages}`, `read=${day.read}`]
  if (day.tally !== null) {
    const dropped = DROPPED_ORDER.map((reason) => `${reason}=${day.tally!.droppedBy[reason]}`).join(' ')
    parts.push(`eligible=${day.tally.eligible}`, `dropped[${dropped}]`)
  }
  return parts.join(' ')
}

/**
 * One session, one line — opened or refused, for every automation. A refused
 * line reuses the refusal wording after the automation and mode; an opened one
 * carries what each day read and what the session did about it. The timestamp
 * is when the session ended, so the file reads in the order sessions closed.
 */
export function formatSessionLine(record: SessionRecord): string {
  const head = [`${stamp(record.endedAt)} KST`, record.automationId, record.mode]

  if (!record.outcome.opened) {
    const [reason, ...wake] = formatRefusalFields({
      reason: record.outcome.reason,
      judgedAt: record.endedAt,
      wake: record.wake,
    })
    return `${[...head, `refused ${reason}`, ...wake].join('  ')}\n`
  }

  const days = record.days.map(formatDaySummary).join(' / ')
  const counts = `executed=${record.outcome.executed} skipped=${record.outcome.skipped} awaiting=${record.outcome.awaitingApproval} failed=${record.outcome.failed}`
  const took = `took=${formatDuration(record.endedAt - record.openedAt)}`
  return `${[...head, 'opened', days, counts, took].join('  ')}\n`
}

export function appendSessionLine(path: string, record: SessionRecord): void {
  try {
    appendFileSync(path, formatSessionLine(record))
  } catch {
    // A diagnostic that takes the session down with it when the disk is full
    // is worse than no diagnostic.
  }
}

/**
 * Gathers what one runtime's session did — its mode, the days it read, when it
 * opened and closed — and writes the line when the session ends. One per
 * runtime: the days and mode belong to the session in flight, not to the
 * automation, and a manual run joining a scheduled one is still one session.
 *
 * The record is assembled here rather than in bootstrap so the collector's
 * per-day tally and the session's progress reports meet in one place, and
 * bootstrap only has to feed them in.
 */
export interface SessionRecorder {
  /** Reset for a session about to open. */
  begin(mode: RunMode): void
  /** Fold a progress report into the day summaries; anything but COLLECTING is ignored. */
  observe(progress: SessionProgress | null): void
  /** A screening collector's per-day tally, which also fixes that day's read count. */
  recordTally(dayStartMs: number, tally: EligibilityTally): void
  /** Write the finished session's line, when a path was configured. */
  complete(outcome: SessionOutcome, wake: WakeRecord | null): void
}

export function createSessionRecorder(deps: {
  readonly automationId: string
  /** Omitted means sessions are not written down — a dev run or a test. */
  readonly path: string | undefined
  readonly now: () => number
}): SessionRecorder {
  let openedAt = 0
  let mode: RunMode = 'MANUAL'
  let days: DayReadSummary[] = []

  const patchDay = (dayStartMs: number, patch: Partial<DayReadSummary>): void => {
    const index = days.findIndex((day) => day.dayStartMs === dayStartMs)
    if (index === -1) {
      days = [...days, { dayStartMs, pages: 0, read: 0, tally: null, ...patch }]
      return
    }
    days = days.map((day, at) => (at === index ? { ...day, ...patch } : day))
  }

  return {
    begin(nextMode) {
      openedAt = deps.now()
      mode = nextMode
      days = []
    },
    observe(progress) {
      if (progress === null || progress.phase !== 'COLLECTING') return
      // A COLLECTING report with no page count is a day opening; the per-page
      // reports that follow carry the pages read and the candidates collected.
      // For a collector that does not screen, collected is the read count.
      if (progress.pagesRead === undefined) {
        patchDay(progress.dayStartMs, {})
        return
      }
      patchDay(progress.dayStartMs, { pages: progress.pagesRead, read: progress.collected ?? 0 })
    },
    recordTally(dayStartMs, tally) {
      patchDay(dayStartMs, { tally, read: tally.read })
    },
    complete(outcome, wake) {
      if (deps.path === undefined) return
      appendSessionLine(deps.path, {
        automationId: deps.automationId,
        mode,
        outcome,
        openedAt,
        endedAt: deps.now(),
        days,
        wake,
      })
    },
  }
}
