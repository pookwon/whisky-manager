import { describe, expect, it } from 'vitest'
import { COLLECTION_PACING_KEY, readCollectionPacing, writeCollectionPacing } from '../../src/desktop/collectionPacingSettings.js'
import { DEFAULT_COLLECTION_PACING } from '../../src/shared/collectionPacing.js'
import type { SettingsRepo } from '../../src/desktop/db/settingsRepo.js'

function memorySettings(initial: Record<string, string> = {}): SettingsRepo {
  const values = new Map(Object.entries(initial))
  return {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  }
}

describe('collection pacing settings', () => {
  it('answers the defaults when nothing was ever saved', () => {
    expect(readCollectionPacing(memorySettings())).toEqual(DEFAULT_COLLECTION_PACING)
  })

  it('answers the defaults for a stored value it cannot read', () => {
    expect(readCollectionPacing(memorySettings({ [COLLECTION_PACING_KEY]: '{not json' }))).toEqual(DEFAULT_COLLECTION_PACING)
    expect(readCollectionPacing(memorySettings({ [COLLECTION_PACING_KEY]: '[1,2]' }))).toEqual(DEFAULT_COLLECTION_PACING)
  })

  it('stores the normalized value and reads it back', () => {
    const settings = memorySettings()
    const written = writeCollectionPacing(settings, {
      perPage: { minSeconds: 0, maxSeconds: 4 },
      everyTwentyPages: { minSeconds: 60, maxSeconds: 20 },
      everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
    })

    expect(written).toEqual({
      perPage: { minSeconds: 1, maxSeconds: 4 },
      everyTwentyPages: { minSeconds: 60, maxSeconds: 60 },
      everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
    })
    expect(readCollectionPacing(settings)).toEqual(written)
  })
})
