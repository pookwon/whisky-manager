import { describe, expect, it, vi } from 'vitest'
import type { SessionOutcome } from '../../src/desktop/orchestrator.js'
import { createSessionLoop, type SessionLoopDeps, type WakeRecord } from '../../src/desktop/sessionLoop.js'
import { KST_OFFSET_MS } from '../../src/shared/kst.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

// Monday morning KST, on the calendar the operator's machine keeps. Early
// enough in the day that the run which closes it never claims these slots —
// what these tests are about is the loop, not the boundary.
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0) - KST_OFFSET_MS
const MID_INTERVAL_MS =
  (PROFILES.production.sessionIntervalMinMs + PROFILES.production.sessionIntervalMaxMs) / 2

const idleOutcome: SessionOutcome = {
  opened: true,
  executed: 0,
  skipped: 0,
  awaitingApproval: 0,
  failed: 0,
}

function loopDeps(overrides: Partial<SessionLoopDeps> = {}): SessionLoopDeps {
  return {
    limits: PROFILES.production,
    clock: new FakeClock(MON_10_00, KST_OFFSET_MS),
    // The middle of the profile's own band, so retuning the profile does not
    // silently push this outside the range and clamp.
    random: new SequenceRandom([MID_INTERVAL_MS]),
    runSession: () => Promise.resolve(idleOutcome),
    onOutcome: () => {},
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    ...overrides,
  }
}

describe('createSessionLoop', () => {
  it('is not running before start', () => {
    expect(createSessionLoop(loopDeps()).isRunning()).toBe(false)
  })

  it('reports running after start and stopped after stop', () => {
    const loop = createSessionLoop(loopDeps({ setTimer: () => 1 }))
    loop.start()
    expect(loop.isRunning()).toBe(true)
    loop.stop()
    expect(loop.isRunning()).toBe(false)
  })

  it('schedules the next session using the jittered interval', () => {
    // Typed params so the assertion can read the delay argument.
    const setTimer = vi.fn((_fn: () => void, _ms: number) => 1)
    const loop = createSessionLoop(loopDeps({ setTimer }))

    loop.start()

    expect(setTimer).toHaveBeenCalledTimes(1)
    expect(setTimer.mock.calls[0]?.[1]).toBe(MID_INTERVAL_MS)
    loop.stop()
  })

  it('cancels the pending timer on stop', () => {
    const clearTimer = vi.fn()
    const loop = createSessionLoop(loopDeps({ setTimer: () => 42, clearTimer }))

    loop.start()
    loop.stop()

    expect(clearTimer).toHaveBeenCalledWith(42)
  })

  it('is idempotent on repeated start', () => {
    const setTimer = vi.fn(() => 1)
    const loop = createSessionLoop(loopDeps({ setTimer }))

    loop.start()
    loop.start()

    expect(setTimer).toHaveBeenCalledTimes(1)
    loop.stop()
  })

  it('runs a session immediately on runOnce and reports the outcome', async () => {
    const outcomes: SessionOutcome[] = []
    const loop = createSessionLoop(loopDeps({ onOutcome: (o) => outcomes.push(o) }))

    await loop.runOnce()

    expect(outcomes).toEqual([idleOutcome])
  })

  it('schedules the next session after one finishes', async () => {
    const fired: Array<() => void> = []
    const setTimer = vi.fn((fn: () => void, _ms: number) => {
      fired.push(fn)
      return 1
    })
    const loop = createSessionLoop(loopDeps({ setTimer }))

    loop.start()
    expect(setTimer).toHaveBeenCalledTimes(1)

    // Drive the timer callback the way the runtime would.
    fired[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setTimer).toHaveBeenCalledTimes(2)
    loop.stop()
  })

  it('does not schedule again once stopped', async () => {
    const fired: Array<() => void> = []
    const setTimer = vi.fn((fn: () => void, _ms: number) => {
      fired.push(fn)
      return 1
    })
    const loop = createSessionLoop(loopDeps({ setTimer }))

    loop.start()
    loop.stop()

    // A timer already in flight must not resurrect the loop.
    fired[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setTimer).toHaveBeenCalledTimes(1)
  })

  it('does not double its cadence when restarted during a session', async () => {
    const fired: Array<() => void> = []
    const setTimer = vi.fn((fn: () => void, _ms: number) => {
      fired.push(fn)
      return fired.length
    })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const loop = createSessionLoop(
      loopDeps({
        setTimer,
        runSession: async () => {
          await held
          return idleOutcome
        },
      }),
    )

    loop.start()
    fired[0]?.()
    // The tray switch is one click, and a production session runs for the
    // better part of an hour, so off and on again inside one is a click apart
    // rather than a rare accident.
    loop.stop()
    loop.start()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The restart owns the schedule now. A session that was already under way
    // must not leave a second timer behind it, or the loop runs twice as often
    // as asked and stopping only ever clears the newer of the two.
    expect(setTimer).toHaveBeenCalledTimes(2)
    loop.stop()
  })

  it('halts immediately when the operator is logged out', async () => {
    const halts: string[] = []
    const loop = createSessionLoop(
      loopDeps({
        setTimer: () => 1,
        runSession: () => Promise.resolve({ opened: false, reason: 'NOT_LOGGED_IN' }),
        onHalt: (reason) => halts.push(reason),
      }),
    )

    loop.start()
    await loop.runOnce()

    expect(halts).toEqual(['NOT_LOGGED_IN'])
    expect(loop.isRunning()).toBe(false)
  })

  it('tolerates login check failures until the third in a row', async () => {
    const halts: string[] = []
    const loop = createSessionLoop(
      loopDeps({
        setTimer: () => 1,
        runSession: () => Promise.resolve({ opened: false, reason: 'LOGIN_CHECK_FAILED' }),
        onHalt: (reason) => halts.push(reason),
      }),
    )

    loop.start()
    await loop.runOnce()
    await loop.runOnce()
    // A flaky network must not take the whole automation down on its own.
    expect(loop.isRunning()).toBe(true)

    await loop.runOnce()
    expect(halts).toEqual(['LOGIN_CHECK_FAILED'])
    expect(loop.isRunning()).toBe(false)
  })

  it('forgets the failure streak after a session opens', async () => {
    const halts: string[] = []
    let fail = true
    const loop = createSessionLoop(
      loopDeps({
        setTimer: () => 1,
        runSession: () =>
          Promise.resolve(fail ? { opened: false, reason: 'LOGIN_CHECK_FAILED' } : idleOutcome),
        onHalt: (reason) => halts.push(reason),
      }),
    )

    loop.start()
    await loop.runOnce()
    await loop.runOnce()
    fail = false
    await loop.runOnce()
    fail = true
    await loop.runOnce()
    await loop.runOnce()

    expect(halts).toEqual([])
    expect(loop.isRunning()).toBe(true)
    loop.stop()
  })

  it('never runs two sessions at once: a runOnce during a session joins it', async () => {
    let release: (outcome: SessionOutcome) => void = () => {}
    const runSession = vi.fn(
      () => new Promise<SessionOutcome>((resolve) => (release = resolve)),
    )
    const loop = createSessionLoop(loopDeps({ runSession }))

    // The dashboard's "run now" while a scheduled session is mid-flight must
    // not start a second session — both could pick up the same queued row.
    const first = loop.runOnce()
    const second = loop.runOnce()
    expect(runSession).toHaveBeenCalledTimes(1)

    release(idleOutcome)
    await Promise.all([first, second])

    const third = loop.runOnce()
    expect(runSession).toHaveBeenCalledTimes(2)
    release(idleOutcome)
    await third
  })

  it('keeps the loop usable when a session throws', async () => {
    const errors: unknown[] = []
    const loop = createSessionLoop(
      loopDeps({
        setTimer: () => 1,
        runSession: () => Promise.reject(new Error('boom')),
        onError: (e) => errors.push(e),
      }),
    )

    await loop.runOnce()

    expect(errors).toHaveLength(1)
    // A thrown session must not leave the loop dead.
    loop.start()
    expect(loop.isRunning()).toBe(true)
    loop.stop()
  })

  it('returns null from nextRunAt before start', () => {
    const loop = createSessionLoop(loopDeps())
    expect(loop.nextRunAt()).toBe(null)
  })

  it('returns the scheduled time from nextRunAt after start', () => {
    const clock = new FakeClock(MON_10_00, KST_OFFSET_MS)
    const loop = createSessionLoop(loopDeps({ clock, setTimer: () => 1 }))

    loop.start()

    const nextRun = loop.nextRunAt()
    expect(nextRun).not.toBeNull()
    expect(nextRun).toBeGreaterThan(MON_10_00)
  })

  it('returns null from nextRunAt after stop', () => {
    const loop = createSessionLoop(loopDeps({ setTimer: () => 1 }))
    loop.start()
    loop.stop()

    expect(loop.nextRunAt()).toBe(null)
  })

  it('updates nextRunAt after a session completes and reschedules', async () => {
    const fired: Array<() => void> = []
    const clock = new FakeClock(MON_10_00, KST_OFFSET_MS)
    const setTimer = vi.fn((fn: () => void, _ms: number) => {
      fired.push(fn)
      return 1
    })
    const loop = createSessionLoop(loopDeps({ clock, setTimer }))

    loop.start()
    const firstNext = loop.nextRunAt()
    expect(firstNext).not.toBeNull()

    // Advance clock and run the scheduled session
    clock.set(MON_10_00 + 50 * 60_000)
    fired[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const secondNext = loop.nextRunAt()
    expect(secondNext).not.toBeNull()
    expect(secondNext).toBeGreaterThan(firstNext!)

    loop.stop()
  })
})

describe('createSessionLoop — what it woke for', () => {
  it('hands the outcome handler the instant it aimed at and the one it woke on', async () => {
    // The pair that has to agree. A session refused for being outside the
    // window it was aimed at the opening of is only explicable from these two.
    const seen: Array<WakeRecord | null> = []
    const fired: Array<() => void> = []
    const clock = new FakeClock(MON_10_00, KST_OFFSET_MS)
    const setTimer = vi.fn((fn: () => void, _ms: number) => {
      fired.push(fn)
      return 1
    })
    const loop = createSessionLoop(
      loopDeps({ clock, setTimer, onOutcome: (_outcome, wake) => seen.push(wake) }),
    )

    loop.start()
    const scheduled = loop.nextRunAt()
    expect(scheduled).not.toBeNull()

    clock.set(scheduled! - 2) // woke two milliseconds early
    fired[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(seen[0]).toEqual({ scheduledFor: scheduled, wokeAt: scheduled! - 2 })
    loop.stop()
  })

  it('reports no wake for a run the operator asked for', async () => {
    const seen: Array<WakeRecord | null> = []
    const loop = createSessionLoop(
      loopDeps({ setTimer: () => 1, onOutcome: (_outcome, wake) => seen.push(wake) }),
    )

    await loop.runOnce()

    expect(seen[0]).toBe(null)
  })
})

describe('createSessionLoop — a manual run holds the schedule', () => {
  /** A session that stays open until the test lets it finish. */
  function heldSession() {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const requests: unknown[] = []
    return {
      requests,
      release,
      runSession: async (request?: unknown): Promise<SessionOutcome> => {
        requests.push(request)
        await held
        return idleOutcome
      },
    }
  }

  it('does not start a session when a manual run is under way', async () => {
    const { requests, release, runSession } = heldSession()
    let fire: () => void = () => {}
    const loop = createSessionLoop(
      loopDeps({
        runSession,
        setTimer: (fn) => {
          fire = fn
          return 1
        },
      }),
    )

    loop.start()
    const manual = loop.runOnce({ mode: 'FORCED' })
    fire()

    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({ mode: 'FORCED' })

    release()
    await manual
  })

  it('does not report the manual run as the schedule\'s own result', async () => {
    // Joining would hand the manual outcome to onOutcome a second time and
    // leave the dashboard calling it the last scheduled session.
    const outcomes: SessionOutcome[] = []
    const { release, runSession } = heldSession()
    let fire: () => void = () => {}
    const loop = createSessionLoop(
      loopDeps({
        runSession,
        onOutcome: (outcome) => outcomes.push(outcome),
        setTimer: (fn) => {
          fire = fn
          return 1
        },
      }),
    )

    loop.start()
    const manual = loop.runOnce({ mode: 'FORCED' })
    fire()
    release()
    await manual

    expect(outcomes).toHaveLength(1)
  })

  it('takes its next turn once the manual run is done', async () => {
    const { release, runSession, requests } = heldSession()
    let fire: () => void = () => {}
    const loop = createSessionLoop(
      loopDeps({
        runSession,
        setTimer: (fn) => {
          fire = fn
          return 1
        },
      }),
    )

    loop.start()
    const manual = loop.runOnce({ mode: 'MANUAL' })
    fire()
    release()
    await manual
    await Promise.resolve()

    // The skipped turn re-armed rather than ending the schedule.
    expect(loop.isRunning()).toBe(true)
    fire()
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual({ mode: 'SCHEDULED' })
  })

  it('runs its turn normally when nothing else is going on', async () => {
    const requests: unknown[] = []
    let fire: () => void = () => {}
    const loop = createSessionLoop(
      loopDeps({
        runSession: (request?: unknown) => {
          requests.push(request)
          return Promise.resolve(idleOutcome)
        },
        setTimer: (fn) => {
          fire = fn
          return 1
        },
      }),
    )

    loop.start()
    fire()
    await Promise.resolve()

    expect(requests).toEqual([{ mode: 'SCHEDULED' }])
  })
})
