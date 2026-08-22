import { describe, expect, it } from 'vitest'
import { PROFILES } from '../../src/shared/profiles.js'
import { isUnresolved } from '../../src/shared/types.js'

describe('profiles', () => {
  it('uses the production session interval from the spec', () => {
    expect(PROFILES.production.sessionIntervalMinMs).toBe(45 * 60_000)
    expect(PROFILES.production.sessionIntervalMaxMs).toBe(75 * 60_000)
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
