import { parseMonthStartSeed, type MonthStartSeed } from '../shared/monthStartSeed.js'
import type { SettingsRepo } from './db/settingsRepo.js'

export const MONTH_START_SEED_KEY = 'monthStartCollectionSeed'

/** Null when nothing was recorded or what was recorded cannot be read. */
export function readMonthStartSeed(settings: SettingsRepo): MonthStartSeed | null {
  const raw = settings.get(MONTH_START_SEED_KEY)
  if (raw === undefined) return null
  try {
    return parseMonthStartSeed(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeMonthStartSeed(settings: SettingsRepo, seed: MonthStartSeed): void {
  settings.set(MONTH_START_SEED_KEY, JSON.stringify(seed))
}
