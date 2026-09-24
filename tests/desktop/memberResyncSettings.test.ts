import { describe, expect, it } from 'vitest'
import { MEMBER_RESYNC_INTERVAL_KEY, readMemberResyncInterval, writeMemberResyncInterval } from '../../src/desktop/memberResyncSettings.js'
import { DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS } from '../../src/shared/memberResync.js'
import type { SettingsRepo } from '../../src/desktop/db/settingsRepo.js'

function memorySettings(initial: Record<string, string> = {}): SettingsRepo {
  const values = new Map(Object.entries(initial))
  return {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  }
}

describe('member re-walk interval setting', () => {
  it('answers the default when nothing, or nothing readable, was saved', () => {
    expect(readMemberResyncInterval(memorySettings())).toBe(DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS)
    expect(readMemberResyncInterval(memorySettings({ [MEMBER_RESYNC_INTERVAL_KEY]: '{' }))).toBe(DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS)
  })

  it('keeps "off" as off, and a choice it does not offer as the default', () => {
    const settings = memorySettings()
    expect(writeMemberResyncInterval(settings, 0)).toBe(0)
    expect(readMemberResyncInterval(settings)).toBe(0)
    expect(writeMemberResyncInterval(settings, 9)).toBe(DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS)
    expect(readMemberResyncInterval(settings)).toBe(DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS)
  })
})
