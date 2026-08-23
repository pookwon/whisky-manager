import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { ko } from '../../src/renderer/locales/ko.js'
import { progressSummary } from '../../src/renderer/format.js'
import type { SessionProgress } from '../../src/desktop/orchestrator.js'

/**
 * Every progress state an operator can land on, rendered through the real i18n
 * stack. Formatting a key correctly and having i18next understand the string
 * are separate things: a template i18next cannot read still passes a test that
 * only checks which key was chosen, and reaches the screen with its braces on.
 */
const STATES: SessionProgress[] = [
  { phase: 'COLLECTING' },
  { phase: 'COLLECTING', pagesRead: 2, collected: 87 },
  { phase: 'BACKLOG', done: 0, total: 3, nickname: '왕밤이' },
  { phase: 'BACKLOG', done: 1, total: 3, nickname: null },
  { phase: 'WORKING', done: 4, total: 120, nickname: '깡총이' },
  { phase: 'WORKING', done: 5, total: 120, nickname: null },
]

beforeAll(async () => {
  await i18next.init({ resources: { ko }, lng: 'ko', fallbackLng: 'ko', interpolation: { escapeValue: false } })
})

describe('progress wording', () => {
  it('leaves no template syntax on screen', () => {
    for (const state of STATES) {
      const summary = progressSummary(state)
      const text = i18next.t(summary.key, summary.values)
      expect(text, `${summary.key} rendered as ${text}`).not.toMatch(/[{}]/)
    }
  })

  it('names a key that exists', () => {
    for (const state of STATES) {
      const summary = progressSummary(state)
      expect(i18next.exists(summary.key), `missing key ${summary.key}`).toBe(true)
    }
  })

  it('shows the counts once collection has read a page', () => {
    const summary = progressSummary({ phase: 'COLLECTING', pagesRead: 2, collected: 87 })
    const text = i18next.t(summary.key, summary.values)
    expect(text).toContain('2')
    expect(text).toContain('87')
  })
})
