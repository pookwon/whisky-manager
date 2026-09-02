import {
  nextCollectionRunTime,
  pagesPerWorkBlock,
  type CollectionSchedule,
} from '../shared/collectionSchedule.js'
import type { CollectionClock } from './collectionOrchestrator.js'
import type { CollectionStartResult } from './collectionRunner.js'
import type { CollectionJob } from './collectionJob.js'

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
  readonly schedule: () => CollectionSchedule
  readonly clock: CollectionClock
  /** The collectable jobs, read on every beat so a job that appears is picked up. */
  readonly jobs: () => readonly CollectionJob[]
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
  /**
   * Whether the stored job is running around the clock. Cached because laying
   * the next beat is synchronous while reading the job is not; every beat
   * refreshes it from the state it has just read, and `refresh` primes it.
   */
  let forced = false
  let lastRunIndex = -1

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
    const at = nextCollectionRunTime(from, schedule, { ignoreActiveWindow: forced })
    if (at === null) return
    scheduledFor = at
    timer = deps.setTimer(() => {
      timer = null
      void beat(at)
    }, Math.max(0, at - deps.clock.now()))
  }

  async function beat(plannedFor: number): Promise<void> {
    const schedule = deps.schedule()
    let attempted: CollectionStartResult | null = null

    if (schedule.enabled) {
      try {
        const jobs = deps.jobs()
        const progress = await Promise.all(jobs.map((job) => job.readProgress()))
        forced = progress.some((p) => p.forced)
        const maxPages = pagesPerWorkBlock(schedule.workBlockMinutes)

        // Daily maintenance (the member top-up) is offered before the main walk
        // and only starts when it is actually due.
        for (let index = 0; index < jobs.length && attempted === null; index += 1) {
          const maintenance = jobs[index]!.startDailyMaintenance
          if (maintenance === undefined) continue
          const result = await maintenance(maxPages, deps.clock.now())
          if (result !== null) {
            attempted = result
            lastRunIndex = index
          }
        }

        // Otherwise round-robin over the unfinished jobs, starting after the one
        // the previous beat ran, so two jobs share the blocks fairly.
        if (attempted === null) {
          const runnable = jobs
            .map((job, index) => ({ job, index }))
            .filter((entry) => progress[entry.index]!.exists && !progress[entry.index]!.complete)
          if (runnable.length > 0) {
            const ordered = [...runnable].sort((a, b) => a.index - b.index)
            const next = ordered.find((entry) => entry.index > lastRunIndex) ?? ordered[0]!
            attempted = next.job.start(maxPages)
            lastRunIndex = next.index
          }
        }

        if (attempted !== null) deps.onStarted?.(attempted, plannedFor)
      } catch (error) {
        deps.onError?.(error)
      }
    }

    lay(beatAfter(attempted, schedule, deps.clock.now()))
  }

  async function prime(): Promise<void> {
    const was = forced
    try {
      const progress = await Promise.all(deps.jobs().map((job) => job.readProgress()))
      forced = progress.some((p) => p.forced)
    } catch (error) {
      deps.onError?.(error)
      return
    }
    if (forced !== was) lay(deps.clock.now())
  }

  return {
    refresh() {
      lay(deps.clock.now())
      void prime()
    },
    stop() {
      clear()
    },
    nextRunAt() {
      return scheduledFor
    },
  }
}
