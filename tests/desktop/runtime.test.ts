import { describe, expect, it } from 'vitest'
import { systemClock, systemRandom } from '../../src/desktop/runtime.js'

describe('systemClock', () => {
  it('reports a plausible current time', () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(1_000)
  })

  it('decomposes a timestamp into local parts', () => {
    const at = new Date(2026, 7, 24, 13, 45, 0).getTime()
    expect(systemClock.parts(at)).toEqual({ hour: 13, minute: 45, dayOfWeek: 1 })
  })

  it('anchors to a local hour on the same day', () => {
    const at = new Date(2026, 7, 24, 13, 45, 30, 500).getTime()
    expect(systemClock.atHour(at, 8)).toBe(new Date(2026, 7, 24, 8, 0, 0, 0).getTime())
  })

  it('adds days on the calendar, keeping the wall-clock time', () => {
    const at = new Date(2026, 7, 31, 12, 0, 0).getTime()
    expect(systemClock.parts(systemClock.addDays(at, 1)).hour).toBe(12)
  })
})

describe('systemRandom', () => {
  it('stays inside the requested range', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = systemRandom.intInclusive(8, 25)
      expect(value).toBeGreaterThanOrEqual(8)
      expect(value).toBeLessThanOrEqual(25)
    }
  })

  it('can return both bounds', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 500; i += 1) seen.add(systemRandom.intInclusive(0, 1))
    expect(seen).toEqual(new Set([0, 1]))
  })
})
