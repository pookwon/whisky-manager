import {
  DEFAULT_COLLECTION_SCHEDULE,
  normalizeCollectionSchedule,
  type CollectionSchedule,
} from '../shared/collectionSchedule.js'
import type { SettingsRepo } from './db/settingsRepo.js'

/**
 * One row rather than five: the schedule is read and written as a whole, and
 * five keys drifting apart is a state no screen ever asked for.
 */
export const COLLECTION_SCHEDULE_KEY = 'collectionSchedule'

/**
 * A stored value that cannot be read is not a reason to refuse to start. The
 * defaults leave the collection switched off, which is the safe reading of "we
 * do not know what this operator asked for".
 */
export function readCollectionSchedule(settings: SettingsRepo): CollectionSchedule {
  const raw = settings.get(COLLECTION_SCHEDULE_KEY)
  if (raw === undefined) return DEFAULT_COLLECTION_SCHEDULE
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_COLLECTION_SCHEDULE
    }
    return normalizeCollectionSchedule(parsed as Partial<CollectionSchedule>)
  } catch {
    return DEFAULT_COLLECTION_SCHEDULE
  }
}

/** Normalized on the way in, so nothing out of range is ever stored. */
export function writeCollectionSchedule(
  settings: SettingsRepo,
  schedule: Partial<CollectionSchedule>,
): CollectionSchedule {
  const normalized = normalizeCollectionSchedule(schedule)
  settings.set(COLLECTION_SCHEDULE_KEY, JSON.stringify(normalized))
  return normalized
}
