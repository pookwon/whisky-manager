import {
  nextCollectionRun,
  scheduledCollectionRange,
  type CollectionSchedule,
} from '../shared/collectionSchedule.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import type { CollectionRunner, CollectionStartResult } from './collectionRunner.js'

export type TimerHandle = number

export interface CollectionLoopDeps {
  /** Read on every beat, so a saved change takes effect without a restart. */
  readonly schedule: () => CollectionSchedule
  readonly runner: CollectionRunner
  /** Only the instant matters here; the calendar is the schedule's business. */
  readonly clock: CollectionClock
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
  readonly onStarted?: (result: CollectionStartResult, scheduledFor: number) => void
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

  function lay(): void {
    clear()
    const now = deps.clock.now()
    const at = nextCollectionRun(now, deps.schedule())
    if (at === null) return
    scheduledFor = at
    timer = deps.setTimer(() => {
      timer = null
      const schedule = deps.schedule()
      // Re-read rather than trusting the beat that was laid: the operator may
      // have switched the collection off while this timer was pending.
      const due = nextCollectionRun(deps.clock.now() - 1, schedule)
      if (due !== null) {
        const result = deps.runner.start({
          range: scheduledCollectionRange(deps.clock.now(), schedule),
          kind: 'incremental',
          maxPages: schedule.maxPages,
        })
        deps.onStarted?.(result, at)
      }
      // A refused start still lays the next beat: a browser that was closed at
      // 02:00 is no reason to stop collecting at 08:00.
      lay()
    }, Math.max(0, at - now))
  }

  return {
    refresh() {
      lay()
    },
    stop() {
      clear()
    },
    nextRunAt() {
      return scheduledFor
    },
  }
}
