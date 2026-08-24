import { describe, expect, it } from 'vitest'
import { checkGates, hasStaleBacklog } from '../../src/shared/limits.js'
import { PROFILES } from '../../src/shared/profiles.js'

const limits = PROFILES.production
const HOUR = 3_600_000

describe('checkGates by run mode', () => {
  const atBothCaps = { killed: false, dailyCount: limits.dailyCap, sessionCount: limits.perSessionCap }
  const atSessionCap = { killed: false, dailyCount: 0, sessionCount: limits.perSessionCap }

  it('holds a scheduled session to both caps', () => {
    expect(checkGates(atSessionCap, limits, 'SCHEDULED')).toEqual({
      allowed: false,
      reason: 'SESSION_CAP_REACHED',
    })
    expect(checkGates({ killed: false, dailyCount: 200, sessionCount: 0 }, limits, 'SCHEDULED')).toEqual({
      allowed: false,
      reason: 'DAILY_CAP_EXCEEDED',
    })
  })

  it('lets a manual run past the session cap but not the daily one', () => {
    expect(checkGates(atSessionCap, limits, 'MANUAL')).toEqual({ allowed: true })
    expect(checkGates({ killed: false, dailyCount: 200, sessionCount: 0 }, limits, 'MANUAL')).toEqual({
      allowed: false,
      reason: 'DAILY_CAP_EXCEEDED',
    })
  })

  it('lets a forced run past both caps', () => {
    expect(checkGates(atBothCaps, limits, 'FORCED')).toEqual({ allowed: true })
  })

  it('stops every mode at the kill switch', () => {
    // The one thing an operator can always reach. A mode that outranked it
    // would leave a long run with no way out.
    for (const mode of ['SCHEDULED', 'MANUAL', 'FORCED'] as const) {
      expect(checkGates({ killed: true, dailyCount: 0, sessionCount: 0 }, limits, mode)).toEqual({
        allowed: false,
        reason: 'KILLED',
      })
    }
  })

  it('treats an unstated mode as the strictest one', () => {
    // Forgetting the argument must not quietly widen what a session may do.
    expect(checkGates(atSessionCap, limits)).toEqual({
      allowed: false,
      reason: 'SESSION_CAP_REACHED',
    })
  })
})

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
    expect(checkGates({ killed: false, dailyCount: 0, sessionCount: limits.perSessionCap }, limits)).toEqual({
      allowed: false,
      reason: 'SESSION_CAP_REACHED',
    })
  })

  it('allows one below each cap', () => {
    expect(
      checkGates(
        { killed: false, dailyCount: limits.dailyCap - 1, sessionCount: limits.perSessionCap - 1 },
        limits,
      ),
    ).toEqual({ allowed: true })
  })

  it('blocks past the daily cap, not only at it', () => {
    expect(checkGates({ killed: false, dailyCount: 201, sessionCount: 0 }, limits)).toEqual({
      allowed: false,
      reason: 'DAILY_CAP_EXCEEDED',
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

