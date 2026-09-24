import {
  DEFAULT_COLLECTION_PACING,
  normalizeCollectionPacing,
  type CollectionPacing,
} from '../shared/collectionPacing.js'
import type { SettingsRepo } from './db/settingsRepo.js'

/** Kept apart from the schedule row: when a block runs and how fast it reads change for different reasons. */
export const COLLECTION_PACING_KEY = 'collectionPacing'

/** A stored value that cannot be read falls back to the defaults rather than refusing to collect. */
export function readCollectionPacing(settings: SettingsRepo): CollectionPacing {
  const raw = settings.get(COLLECTION_PACING_KEY)
  if (raw === undefined) return DEFAULT_COLLECTION_PACING
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_COLLECTION_PACING
    }
    return normalizeCollectionPacing(parsed as Partial<CollectionPacing>)
  } catch {
    return DEFAULT_COLLECTION_PACING
  }
}

/** Normalized on the way in, so nothing under the floor is ever stored. */
export function writeCollectionPacing(settings: SettingsRepo, pacing: Partial<CollectionPacing>): CollectionPacing {
  const normalized = normalizeCollectionPacing(pacing)
  settings.set(COLLECTION_PACING_KEY, JSON.stringify(normalized))
  return normalized
}
