import { describe, expect, it } from 'vitest'
import { MEMBER_RESYNC_AUTO_KEY, readMemberResyncAuto, writeMemberResyncAuto } from '../../src/desktop/memberResyncSettings.js'
import type { SettingsRepo } from '../../src/desktop/db/settingsRepo.js'

function memorySettings(initial: Record<string, string> = {}): SettingsRepo {
  const values = new Map(Object.entries(initial))
  return {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  }
}

describe('member re-walk automatic switch', () => {
  it('is on when nothing, or nothing readable, was saved', () => {
    expect(readMemberResyncAuto(memorySettings())).toBe(true)
    expect(readMemberResyncAuto(memorySettings({ [MEMBER_RESYNC_AUTO_KEY]: '{' }))).toBe(true)
  })

  it('keeps what was written', () => {
    const settings = memorySettings()
    expect(writeMemberResyncAuto(settings, false)).toBe(false)
    expect(readMemberResyncAuto(settings)).toBe(false)
    expect(writeMemberResyncAuto(settings, true)).toBe(true)
    expect(readMemberResyncAuto(settings)).toBe(true)
  })

  it('reads the interval an earlier build stored: 0 was off, any number on', () => {
    expect(readMemberResyncAuto(memorySettings({ [MEMBER_RESYNC_AUTO_KEY]: '0' }))).toBe(false)
    expect(readMemberResyncAuto(memorySettings({ [MEMBER_RESYNC_AUTO_KEY]: '30' }))).toBe(true)
  })
})
