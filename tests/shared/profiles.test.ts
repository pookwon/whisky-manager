import { describe, expect, it } from 'vitest'
import { PROFILES } from '../../src/shared/profiles.js'
import { isUnresolved } from '../../src/shared/types.js'

describe('profiles', () => {
  it('spaces production sessions about four hours apart', () => {
    const HOUR = 3_600_000
    expect(PROFILES.production.sessionIntervalMinMs).toBe(3 * HOUR)
    expect(PROFILES.production.sessionIntervalMaxMs).toBe(5 * HOUR)
  })

  it('leaves production a session wide enough for a day it missed', () => {
    // Four sessions across the 14-hour window against 100~150 greetings a day,
    // before the run that closes the day is counted at all.
    const sessionsPerDay = 4
    expect(PROFILES.production.perSessionCap * sessionsPerDay).toBeGreaterThan(150)
  })

  it('uses a shorter debug cadence than production', () => {
    expect(PROFILES.debug.sessionIntervalMaxMs).toBeLessThan(PROFILES.production.sessionIntervalMinMs)
  })

  it('keeps every interval range ordered', () => {
    for (const limits of Object.values(PROFILES)) {
      expect(limits.sessionIntervalMinMs).toBeLessThanOrEqual(limits.sessionIntervalMaxMs)
      expect(limits.actionIntervalMinMs).toBeLessThanOrEqual(limits.actionIntervalMaxMs)
    }
  })

  it('gives the backlog brake room for the two days a session works', () => {
    // A session settles yesterday before working today, so a post from yesterday
    // morning is a day old by the time today's morning session sees it. A
    // twenty-four hour window would read that as a broken tool and stop.
    for (const profile of Object.values(PROFILES)) {
      expect(profile.backlogMaxAgeMs).toBe(48 * 3_600_000)
    }
  })
})

describe('isUnresolved', () => {
  it('treats work-owing statuses as unresolved', () => {
    expect(isUnresolved('AWAITING_APPROVAL')).toBe(true)
    expect(isUnresolved('QUEUED')).toBe(true)
    expect(isUnresolved('RETRY_WAIT')).toBe(true)
  })

  it('treats terminal statuses as resolved', () => {
    expect(isUnresolved('SUCCESS')).toBe(false)
    expect(isUnresolved('SKIPPED')).toBe(false)
    expect(isUnresolved('CANCELLED')).toBe(false)
  })
})
