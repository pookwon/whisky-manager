import {
  nextCollectionRunTime,
  pagesPerWorkBlock,
  type CollectionSchedule,
} from '../shared/collectionSchedule.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import type { CollectionRunner, CollectionStartResult } from './collectionRunner.js'
import type { CollectionFeed, CollectionRepository } from './collection-db/repository.js'

export type TimerHandle = number

const MINUTE_MS = 60_000

/**
 * How soon a beat looks again after finding no extension to read through.
 *
 * The extension dials the app about once a minute, so a browser that is up
 * reconnects within one of these. A full rest instead would push the first
 * collection after the app starts out by the whole rest period — two hours on
 * the defaults — for want of a socket that arrived a second later: the app
 * listens the moment it starts and beats immediately, while the extension is
 * still waiting on its own retry.
 */
const BRIDGE_RETRY_MINUTES = 2

export interface CollectionLoopDeps {
  /** Read on every beat, so a saved change takes effect without a restart. */
  readonly schedule: () => CollectionSchedule
  readonly runner: CollectionRunner
  /** Only the instant matters here; the calendar is the schedule's business. */
  readonly clock: CollectionClock
  /** Null while no collection database is usable, which is a normal install. */
  readonly repository: () => CollectionRepository | null
  readonly feed: CollectionFeed
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
  readonly onStarted?: (result: CollectionStartResult, scheduledFor: number) => void
  readonly onError?: (error: unknown) => void
}

export interface CollectionLoop {
  /** Idempotent; re-reads the schedule and re-lays the next beat. */
  refresh(): void
  stop(): void
  nextRunAt(): number | null
}

/**
 * Owns when the collection reads on its own.
 *
 * Nothing about a run lives here — the runner owns that — so a schedule change,
 * a manual run and a scheduled one cannot disagree about what is in flight.
 */
export function createCollectionLoop(deps: CollectionLoopDeps): CollectionLoop {
  let timer: TimerHandle | null = null
  let scheduledFor: number | null = null

  function clear(): void {
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    scheduledFor = null
  }

  /**
   * When to wake next, given how this beat ended.
   *
   * A started block occupies its work length and is then followed by the rest,
   * which is what the operator set the two numbers for. A missing extension is
   * not a block that happened, so it is not paid for with a rest — it is looked
   * at again shortly. Anything else waits one rest before looking again: asking
   * the database whether a job appeared is cheap, but asking it continuously is
   * a busy loop, which is exactly what happens if the next beat is laid at the
   * current instant while the active window is open.
   */
  function beatAfter(
    result: CollectionStartResult | null,
    schedule: CollectionSchedule,
    nowMs: number,
  ): number {
    if (result?.kind === 'started') {
      return nowMs + (schedule.workBlockMinutes + schedule.restMinutes) * MINUTE_MS
    }
    if (result?.kind === 'refused' && result.reason === 'BRIDGE_OFFLINE') {
      return nowMs + BRIDGE_RETRY_MINUTES * MINUTE_MS
    }
    return nowMs + schedule.restMinutes * MINUTE_MS
  }

  function lay(from: number): void {
    clear()
    const schedule = deps.schedule()
    const at = nextCollectionRunTime(from, schedule)
    if (at === null) return
    scheduledFor = at
    timer = deps.setTimer(() => {
      timer = null
      void beat(at)
    }, Math.max(0, at - deps.clock.now()))
  }

  async function beat(plannedFor: number): Promise<void> {
    const schedule = deps.schedule()
    /** How the start went, or null when this beat did not try to start one. */
    let attempted: CollectionStartResult | null = null

    // Re-read rather than trusting the beat that was laid: the operator may
    // have switched the collection off while this timer was pending.
    if (schedule.enabled) {
      try {
        const repository = deps.repository()
        // Only an unfinished job is continued. A beat never starts one, so an
        // install with nothing to collect makes no request to the cafe at all —
        // and neither does one whose period has already been walked to its end.
        const state = repository === null ? null : await repository.readFeedState(deps.feed)
        if (state !== null && !state.complete) {
          const result = deps.runner.start({
            range: { startMs: state.targetStartMs, endMs: state.targetEndMs },
            kind: 'incremental',
            maxPages: pagesPerWorkBlock(schedule.workBlockMinutes),
            resumeFromCheckpoint: true,
          })
          attempted = result
          deps.onStarted?.(result, plannedFor)
        }
      } catch (error) {
        // A database that answered badly is no reason to stop the rhythm; the
        // next beat asks again.
        deps.onError?.(error)
      }
    }

    // The next beat is laid whether or not this one ran: a browser that was
    // closed at one block is no reason to stop collecting at the next.
    lay(beatAfter(attempted, schedule, deps.clock.now()))
  }

  return {
    refresh() {
      lay(deps.clock.now())
    },
    stop() {
      clear()
    },
    nextRunAt() {
      return scheduledFor
    },
  }
}
