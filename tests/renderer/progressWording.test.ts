import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { ko } from '../../src/renderer/locales/ko.js'
import { estimatedMinutes, progressSummary } from '../../src/renderer/format.js'
import type { SessionProgress } from '../../src/desktop/orchestrator.js'

const t = (key: string): string => i18next.t(key)

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

describe('run confirmation wording', () => {
  /** Every line the confirmation panel can show, with the values it passes. */
  const LINES: readonly (readonly [string, Record<string, string | number>])[] = [
    ['run.confirmHeading', {}],
    ['run.outsideHours', {}],
    ['run.chosenDay', { date: '2026-08-20' }],
    ['run.bypasses', {}],
    ['run.counting', {}],
    ['run.countFailed', {}],
    ['run.target', {}],
    ['run.alreadyHandled', {}],
    ['run.estimate', {}],
    ['run.countUnit', { count: 154 }],
    ['run.countWithPending', { count: 154, pending: 45 }],
    ['run.minutesUnit', { minutes: 42 }],
    ['run.confirm', {}],
    ['run.cancel', {}],
    ['run.dayLabel', {}],
    ['run.dayRun', {}],
    ['outcome.refused.FUTURE_DAY', {}],
  ]

  it('names keys that exist', () => {
    for (const [key] of LINES) {
      expect(i18next.exists(key), `missing key ${key}`).toBe(true)
    }
  })

  it('leaves no template syntax on screen', () => {
    for (const [key, values] of LINES) {
      const text = i18next.t(key, values)
      expect(text, `${key} rendered as ${text}`).not.toMatch(/[{}]/)
    }
  })

  it('puts the numbers the operator is deciding on into the text', () => {
    expect(i18next.t('run.countUnit', { count: 154 })).toContain('154')
    expect(i18next.t('run.minutesUnit', { minutes: 42 })).toContain('42')
    expect(i18next.t('run.chosenDay', { date: '2026-08-20' })).toContain('2026-08-20')
  })

  it('labels the three figures apart from each other', () => {
    // Read together they are one number; the operator is comparing them.
    const labels = [t('run.target'), t('run.alreadyHandled'), t('run.estimate')]
    expect(new Set(labels).size).toBe(3)
  })
})

describe('estimatedMinutes', () => {
  it('turns a count into the order of magnitude an operator is deciding on', () => {
    // 154 posts at the production average of 16.5s is a little over 42 minutes.
    expect(estimatedMinutes(154, 16_500)).toBe(42)
  })

  it('never promises less than a minute for work that exists', () => {
    expect(estimatedMinutes(1, 16_500)).toBe(1)
    expect(estimatedMinutes(0, 16_500)).toBe(1)
  })
})
