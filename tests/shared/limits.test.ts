import { describe, expect, it } from 'vitest'
import { checkGates, dailyWindowStart, hasStaleBacklog } from '../../src/shared/limits.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock } from '../fakes.js'

const limits = PROFILES.production
const HOUR = 3_600_000

describe('checkGates', () => {
  it('allows a normal candidate', () => {
    expect(checkGates({ killed: false, dailyCount: 10, sessionCount: 2 }, limits)).toEqual({ allowed: true })
  })

  it('blocks everything when the kill switch is engaged', () => {
    expect(checkGates({ killed: true, dailyCount: 0, sessionCount: 0 }, limits)).toEqual({
      allowed: false,
      reason: 'KILLED',
    })
  })

  it('blocks once the daily cap is reached', () => {
    expect(checkGates({ killed: false, dailyCount: 200, sessionCount: 0 }, limits)).toEqual({
      allowed: false,
      reason: 'DAILY_CAP_EXCEEDED',
    })
  })

  it('blocks once the per-session cap is reached', () => {
    expect(checkGates({ killed: false, dailyCount: 0, sessionCount: 15 }, limits)).toEqual({
      allowed: false,
      reason: 'SESSION_CAP_REACHED',
    })
  })

  it('reports the kill switch before any cap', () => {
    expect(checkGates({ killed: true, dailyCount: 999, sessionCount: 999 }, limits)).toEqual({
      allowed: false,
      reason: 'KILLED',
    })
  })
})

describe('hasStaleBacklog', () => {
  const now = Date.UTC(2026, 7, 24, 10, 0, 0)

  it('is false when there is no unresolved work', () => {
    expect(hasStaleBacklog([], now, limits)).toBe(false)
  })

  it('is false when unresolved posts are all recent', () => {
    expect(hasStaleBacklog([{ postedAt: now - 6 * HOUR }], now, limits)).toBe(false)
  })

  it('is true when any unresolved post is older than the age limit', () => {
    expect(hasStaleBacklog([{ postedAt: now - 6 * HOUR }, { postedAt: now - 30 * HOUR }], now, limits)).toBe(true)
  })

  it('does not trip on a large but fresh backlog', () => {
    const fresh = Array.from({ length: 80 }, () => ({ postedAt: now - 2 * HOUR }))
    expect(hasStaleBacklog(fresh, now, limits)).toBe(false)
  })
})

describe('dailyWindowStart', () => {
  it('anchors the day to the operating window start', () => {
    const at = Date.UTC(2026, 7, 24, 10, 0, 0)
    expect(dailyWindowStart(at, limits, new FakeClock(at))).toBe(Date.UTC(2026, 7, 24, 8, 0, 0))
  })

  it('rolls back to the previous day before the window opens', () => {
    const at = Date.UTC(2026, 7, 24, 3, 0, 0)
    expect(dailyWindowStart(at, limits, new FakeClock(at))).toBe(Date.UTC(2026, 7, 23, 8, 0, 0))
  })
})
