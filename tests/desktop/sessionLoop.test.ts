import { describe, expect, it, vi } from 'vitest'
import type { SessionOutcome } from '../../src/desktop/orchestrator.js'
import { createSessionLoop, type SessionLoopDeps } from '../../src/desktop/sessionLoop.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

const idleOutcome: SessionOutcome = {
  opened: true,
  executed: 0,
  skipped: 0,
  awaitingApproval: 0,
  failed: 0,
  expired: 0,
}

function loopDeps(overrides: Partial<SessionLoopDeps> = {}): SessionLoopDeps {
  return {
    limits: PROFILES.production,
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([50 * 60_000]),
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
    expect(setTimer.mock.calls[0]?.[1]).toBe(50 * 60_000)
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
    const clock = new FakeClock(MON_10_00)
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
    const clock = new FakeClock(MON_10_00)
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
