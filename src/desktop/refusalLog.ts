import { KST_OFFSET_MS } from '../shared/kst.js'
import type { SessionRefusal } from './orchestrator.js'
import type { WakeRecord } from './sessionLoop.js'

export interface RefusedSession {
  readonly reason: SessionRefusal
  /** The instant the session was judged at. */
  readonly judgedAt: number
  /** Null for a run nothing scheduled — an operator's, or the first after a start. */
  readonly wake: WakeRecord | null
}

/**
 * KST to the millisecond. The disagreement this file exists to catch is a small
 * one — a session refused for being outside a window it was aimed at the
 * opening of — and rounding to the second would hide exactly that.
 */
export function stamp(epochMs: number): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', '')
}

const STAMP_LENGTH = '2026-08-26 10:00:00.000'.length

/**
 * The instant a line's leading stamp names, or null when the line does not
 * begin with one. The inverse of `stamp`, for reading the log back.
 */
export function parseStamp(line: string): number | null {
  const head = line.slice(0, STAMP_LENGTH)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(head)) return null
  const epochMs = Date.parse(`${head.replace(' ', 'T')}Z`) - KST_OFFSET_MS
  return Number.isNaN(epochMs) ? null : epochMs
}

/**
 * The reason and, if the run was scheduled, how far the wake drifted — the tail
 * of a refusal line, without the leading timestamp. Shared so the one-line
 * session log can reuse the same wording after its own automation and mode,
 * rather than spelling the drift out a second time.
 */
export function formatRefusalFields(session: RefusedSession): string[] {
  if (session.wake === null) return [session.reason, 'unscheduled']
  const driftMs = session.wake.wokeAt - session.wake.scheduledFor
  return [
    session.reason,
    `scheduled ${stamp(session.wake.scheduledFor)} KST`,
    driftMs < 0 ? `woke ${-driftMs}ms early` : `woke ${driftMs}ms late`,
  ]
}

/**
 * One refusal, one line.
 *
 * A refused session writes nothing else down: executions are all a session
 * records, and a session that never opened has none. So when the schedule and
 * the gate disagree about whether the window was open, nothing survives to say
 * which of them was reading what — the outcome lives in memory and is gone at
 * the next restart. This is the line that survives.
 */
export function formatRefusal(session: RefusedSession): string {
  return `${[`${stamp(session.judgedAt)} KST`, ...formatRefusalFields(session)].join('  ')}\n`
}
