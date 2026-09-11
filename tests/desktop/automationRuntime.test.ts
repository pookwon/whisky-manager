import { describe, expect, it } from 'vitest'
import { createAutomationRuntime } from '../../src/desktop/automationRuntime.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

function runtime(outcome = { opened: true, executed: 1, skipped: 0, awaitingApproval: 0, failed: 0 } as const) {
  const outcomes: unknown[] = []
  const rt = createAutomationRuntime({
    automationId: 'x',
    limits: PROFILES.debug,
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([0]),
    runSession: () => Promise.resolve(outcome),
    onOutcome: (o) => outcomes.push(o),
    onHalt: () => {},
    onError: () => {},
    setTimer: () => 1,
    clearTimer: () => {},
  })
  return { rt, outcomes }
}

describe('createAutomationRuntime', () => {
  it('remembers the last outcome and when it arrived', async () => {
    const { rt, outcomes } = runtime()
    expect(rt.lastOutcome()).toBeNull()
    await rt.runOnce()
    expect(rt.lastOutcome()).toEqual({ opened: true, executed: 1, skipped: 0, awaitingApproval: 0, failed: 0 })
    expect(rt.lastOutcomeAt()).toBe(MON_10_00)
    expect(outcomes).toHaveLength(1)
  })

  it('clears progress once the session ends, even one that threw', async () => {
    const rt = createAutomationRuntime({
      automationId: 'x', limits: PROFILES.debug, clock: new FakeClock(MON_10_00), random: new SequenceRandom([0]),
      runSession: () => { rt.reportProgress({ phase: 'COLLECTING' }); return Promise.reject(new Error('boom')) },
      onOutcome: () => {}, onHalt: () => {}, onError: () => {}, setTimer: () => 1, clearTimer: () => {},
    })
    await rt.runOnce()
    expect(rt.sessionProgress()).toBeNull()
  })

  it('reports the next scheduled run only while running', () => {
    const { rt } = runtime()
    expect(rt.nextRunAt()).toBeNull()
    rt.start()
    expect(rt.nextRunAt()).not.toBeNull()
    rt.stop()
    expect(rt.nextRunAt()).toBeNull()
  })
})
