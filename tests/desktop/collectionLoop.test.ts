import { describe, expect, it } from 'vitest'
import { createCollectionLoop } from '../../src/desktop/collectionLoop.js'
import {
  DEFAULT_COLLECTION_SCHEDULE,
  type CollectionSchedule,
} from '../../src/shared/collectionSchedule.js'
import type { CollectionStartRequest, CollectionStartResult } from '../../src/desktop/collectionRunner.js'

const HOUR = 3_600_000
/** 2026-08-31 09:00 KST, well before the 14:00 slot of an 02:00 six-hour grid. */
const NOW = Date.UTC(2026, 7, 31, 0)

function harness(schedule: CollectionSchedule, startResult: CollectionStartResult = { kind: 'started' }) {
  const timers: { fn: () => void; ms: number; handle: number }[] = []
  const started: CollectionStartRequest[] = []
  const cleared: number[] = []
  let now = NOW
  let current = schedule
  let handles = 0

  const loop = createCollectionLoop({
    schedule: () => current,
    runner: {
      start: (request) => {
        started.push(request)
        return startResult
      },
      stop: () => undefined,
      isRunning: () => false,
    },
    clock: { now: () => now },
    setTimer: (fn, ms) => {
      handles += 1
      timers.push({ fn, ms, handle: handles })
      return handles
    },
    clearTimer: (handle) => cleared.push(handle),
  })

  return {
    loop,
    started,
    cleared,
    timers,
    setSchedule: (next: CollectionSchedule) => {
      current = next
    },
    /** Runs the pending timer as if the clock had reached its deadline. */
    fire: () => {
      const pending = timers.pop()
      if (pending === undefined) throw new Error('no timer pending')
      now += pending.ms
      pending.fn()
    },
    nowMs: () => now,
  }
}

const enabled: CollectionSchedule = { ...DEFAULT_COLLECTION_SCHEDULE, enabled: true }

describe('collection loop', () => {
  it('waits for the next slot on the cafe clock, not for an interval from now', () => {
    const h = harness(enabled)
    h.loop.refresh()

    // 09:00 KST to the 14:00 slot is five hours, not the six-hour interval.
    expect(h.timers[0]?.ms).toBe(5 * HOUR)
    expect(h.loop.nextRunAt()).toBe(NOW + 5 * HOUR)
  })

  it('lays nothing while switched off or left to the operator', () => {
    for (const schedule of [
      { ...enabled, enabled: false },
      { ...enabled, interval: 'MANUAL' as const },
    ]) {
      const h = harness(schedule)
      h.loop.refresh()
      expect(h.timers).toHaveLength(0)
      expect(h.loop.nextRunAt()).toBeNull()
    }
  })

  it('asks for the configured window ending now, and keeps beating', () => {
    const h = harness({ ...enabled, rangeDays: 3, maxPages: 40 })
    h.loop.refresh()
    h.fire()

    expect(h.started).toHaveLength(1)
    expect(h.started[0]?.maxPages).toBe(40)
    expect(h.started[0]?.kind).toBe('incremental')
    expect(h.started[0]?.range.endMs).toBe(h.nowMs())
    expect(h.started[0]?.range.startMs).toBe(h.nowMs() - 3 * 24 * HOUR)
    // The next beat is laid whether or not this one ran.
    expect(h.loop.nextRunAt()).toBe(h.nowMs() + 6 * HOUR)
  })

  it('keeps beating after a refused start', () => {
    // A browser that was closed at 02:00 is no reason to stop collecting at 08:00.
    const h = harness(enabled, { kind: 'refused', reason: 'BRIDGE_OFFLINE' })
    h.loop.refresh()
    h.fire()

    expect(h.started).toHaveLength(1)
    expect(h.loop.nextRunAt()).not.toBeNull()
  })

  it('does not run a beat the operator switched off while it was pending', () => {
    const h = harness(enabled)
    h.loop.refresh()
    h.setSchedule({ ...enabled, enabled: false })
    h.fire()

    expect(h.started).toHaveLength(0)
    expect(h.loop.nextRunAt()).toBeNull()
  })

  it('replaces the pending beat when the schedule is saved again', () => {
    const h = harness(enabled)
    h.loop.refresh()
    const first = h.timers[0]?.handle
    h.setSchedule({ ...enabled, interval: 'DAILY' })
    h.loop.refresh()

    // The old timer is cancelled rather than left to fire alongside the new one.
    expect(h.cleared).toContain(first)
    expect(h.loop.nextRunAt()).toBe(Date.UTC(2026, 7, 31, 17))
  })

  it('stops leaves nothing pending', () => {
    const h = harness(enabled)
    h.loop.refresh()
    h.loop.stop()

    expect(h.cleared).toHaveLength(1)
    expect(h.loop.nextRunAt()).toBeNull()
  })
})
