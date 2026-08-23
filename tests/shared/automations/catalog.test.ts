import { describe, expect, it } from 'vitest'
import {
  AUTOMATIONS,
  assertRuntimesRegistered,
  findAutomation,
} from '../../../src/shared/automations/catalog.js'

describe('automation catalogue', () => {
  it('lists the welcome comment automation', () => {
    expect(AUTOMATIONS.map((a) => a.id)).toContain('welcome-comment')
  })

  it('gives every entry a distinct id', () => {
    expect(new Set(AUTOMATIONS.map((a) => a.id)).size).toBe(AUTOMATIONS.length)
  })

  it('gives every entry at least one panel', () => {
    for (const automation of AUTOMATIONS) {
      expect(automation.panels.length).toBeGreaterThan(0)
    }
  })

  it('finds an entry by id', () => {
    expect(findAutomation('welcome-comment')?.labelKey).toBe('automation.welcomeComment')
  })

  it('returns undefined for an unknown id', () => {
    expect(findAutomation('nope')).toBeUndefined()
  })
})

describe('assertRuntimesRegistered', () => {
  it('passes when every catalogue entry has a runtime', () => {
    expect(() => assertRuntimesRegistered(AUTOMATIONS.map((a) => a.id))).not.toThrow()
  })

  it('names the automation that has no runtime', () => {
    expect(() => assertRuntimesRegistered([])).toThrow(/welcome-comment/)
  })

  it('ignores a registered runtime that the catalogue does not list', () => {
    expect(() =>
      assertRuntimesRegistered([...AUTOMATIONS.map((a) => a.id), 'not-in-catalogue']),
    ).not.toThrow()
  })
})
