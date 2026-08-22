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
  lastProcessedPostId: null,
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
})
