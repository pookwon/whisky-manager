import { describe, expect, it } from 'vitest'
import { MONTH_START_SEED_KEY, readMonthStartSeed, writeMonthStartSeed } from '../../src/desktop/monthStartSeedSettings.js'
import type { SettingsRepo } from '../../src/desktop/db/settingsRepo.js'

function memorySettings(initial: Record<string, string> = {}): SettingsRepo {
  const values = new Map(Object.entries(initial))
  return { get: (key) => values.get(key), set: (key, value) => void values.set(key, value), remove: (key) => void values.delete(key) }
}

const SEED = { period: { startMs: 1, endMs: 2 }, replaced: { startMs: 0, endMs: 1 }, madeAtMs: 3 }

describe('month start seed setting', () => {
  it('reads back what was written', () => {
    const settings = memorySettings()
    writeMonthStartSeed(settings, SEED)
    expect(readMonthStartSeed(settings)).toEqual(SEED)
    writeMonthStartSeed(settings, { ...SEED, replaced: null })
    expect(readMonthStartSeed(settings)?.replaced).toBeNull()
  })

  it('reads nothing, or nothing readable, as no seed', () => {
    expect(readMonthStartSeed(memorySettings())).toBeNull()
    for (const raw of ['{', '3', '{"period":{"startMs":1}}', '{"period":{"startMs":1,"endMs":2},"replaced":5,"madeAtMs":3}']) {
      expect(readMonthStartSeed(memorySettings({ [MONTH_START_SEED_KEY]: raw }))).toBeNull()
    }
  })
})
