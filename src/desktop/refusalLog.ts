import { appendFileSync } from 'node:fs'
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
function stamp(epochMs: number): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().replace('T', ' ').replace('Z', '')
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
  const fields = [`${stamp(session.judgedAt)} KST`, session.reason]
  if (session.wake === null) {
    fields.push('unscheduled')
  } else {
    const driftMs = session.wake.wokeAt - session.wake.scheduledFor
    fields.push(
      `scheduled ${stamp(session.wake.scheduledFor)} KST`,
      driftMs < 0 ? `woke ${-driftMs}ms early` : `woke ${driftMs}ms late`,
    )
  }
  return `${fields.join('  ')}\n`
}

export function appendRefusal(path: string, session: RefusedSession): void {
  try {
    appendFileSync(path, formatRefusal(session))
  } catch {
    // A diagnostic that takes the session down with it when the disk is full
    // is worse than no diagnostic.
  }
}
