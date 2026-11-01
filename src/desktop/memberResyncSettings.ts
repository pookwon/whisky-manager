import type { SettingsRepo } from './db/settingsRepo.js'

/** The key the interval in days was once stored under; a stored 0 meant off and is still read so. */
export const MEMBER_RESYNC_AUTO_KEY = 'memberResyncIntervalDays'

/** Anything unreadable, or a number other than the old 0, leaves the automatic re-walk on rather than turning it off. */
export function readMemberResyncAuto(settings: SettingsRepo): boolean {
  const raw = settings.get(MEMBER_RESYNC_AUTO_KEY)
  if (raw === undefined) return true
  try {
    const value: unknown = JSON.parse(raw)
    return value !== false && value !== 0
  } catch {
    return true
  }
}

export function writeMemberResyncAuto(settings: SettingsRepo, enabled: boolean): boolean {
  settings.set(MEMBER_RESYNC_AUTO_KEY, JSON.stringify(enabled))
  return enabled
}
