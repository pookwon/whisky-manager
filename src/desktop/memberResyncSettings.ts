import {
  DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS,
  normalizeMemberResyncInterval,
  type MemberResyncIntervalDays,
} from '../shared/memberResync.js'
import type { SettingsRepo } from './db/settingsRepo.js'

export const MEMBER_RESYNC_INTERVAL_KEY = 'memberResyncIntervalDays'

/** A stored value that cannot be read falls back to the default rather than turning the re-walk off. */
export function readMemberResyncInterval(settings: SettingsRepo): MemberResyncIntervalDays {
  const raw = settings.get(MEMBER_RESYNC_INTERVAL_KEY)
  if (raw === undefined) return DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS
  try {
    return normalizeMemberResyncInterval(JSON.parse(raw))
  } catch {
    return DEFAULT_MEMBER_RESYNC_INTERVAL_DAYS
  }
}

export function writeMemberResyncInterval(settings: SettingsRepo, days: number): MemberResyncIntervalDays {
  const normalized = normalizeMemberResyncInterval(days)
  settings.set(MEMBER_RESYNC_INTERVAL_KEY, JSON.stringify(normalized))
  return normalized
}
