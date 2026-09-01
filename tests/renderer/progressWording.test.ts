import { describe, expect, it } from 'vitest'
import { TEXT } from '../../src/shared/text.js'
import { estimatedMinutes, progressSummary } from '../../src/renderer/format.js'
import type { SessionProgress } from '../../src/desktop/orchestrator.js'

/**
 * Every progress state an operator can land on, rendered the way the screen
 * renders it.
 *
 * Two of the three things this file used to guard are now the compiler's: a
 * name that does not exist in the catalogue will not build, and a line that
 * takes a count cannot be called without one. What is left is the part no type
 * can see — that the words themselves carry no stray template syntax, and that
 * the numbers an operator is deciding on actually reach the string.
 */
const STATES: SessionProgress[] = [
  { phase: 'COLLECTING' },
  { phase: 'COLLECTING', pagesRead: 2, collected: 87 },
  { phase: 'BACKLOG', done: 0, total: 3, nickname: '왕밤이' },
  { phase: 'BACKLOG', done: 1, total: 3, nickname: null },
  { phase: 'WORKING', done: 4, total: 120, nickname: '깡총이' },
  { phase: 'WORKING', done: 5, total: 120, nickname: null },
]

describe('progress wording', () => {
  it('leaves no template syntax on screen', () => {
    for (const state of STATES) {
      const text = progressSummary(state)
      expect(text, `${state.phase} rendered as ${text}`).not.toMatch(/[{}]/)
    }
  })

  it('says something for every state', () => {
    for (const state of STATES) {
      expect(progressSummary(state), `${state.phase} rendered blank`).not.toBe('')
    }
  })

  it('shows the counts once collection has read a page', () => {
    const text = progressSummary({ phase: 'COLLECTING', pagesRead: 2, collected: 87 })
    expect(text).toContain('2')
    expect(text).toContain('87')
  })

  it('puts the walk position and total into the words', () => {
    const text = progressSummary({ phase: 'WORKING', done: 4, total: 120, nickname: '깡총이' })
    expect(text).toContain('5')
    expect(text).toContain('120')
    expect(text).toContain('깡총이')
  })
})

describe('run confirmation wording', () => {
  /** Every line the confirmation panel can show, with the values it passes. */
  const LINES: readonly string[] = [
    TEXT.run.confirmHeading,
    TEXT.run.outsideHours('08~24시'),
    TEXT.run.chosenDay('2026-08-20'),
    TEXT.run.bypasses,
    TEXT.run.counting,
    TEXT.run.countFailed,
    TEXT.run.target,
    TEXT.run.alreadyHandled,
    TEXT.run.estimate,
    TEXT.run.countUnit(154),
    TEXT.run.countWithPending(154, 45),
    TEXT.run.minutesUnit(42),
    TEXT.run.confirm,
    TEXT.run.cancel,
    TEXT.run.dayLabel,
    TEXT.run.dayRun,
    TEXT.outcome.refused.FUTURE_DAY,
  ]

  it('leaves no template syntax on screen', () => {
    for (const line of LINES) {
      expect(line, `rendered as ${line}`).not.toMatch(/[{}]/)
    }
  })

  it('says something on every line', () => {
    for (const line of LINES) {
      expect(line).not.toBe('')
    }
  })

  it('puts the numbers the operator is deciding on into the text', () => {
    expect(TEXT.run.countUnit(154)).toContain('154')
    expect(TEXT.run.minutesUnit(42)).toContain('42')
    expect(TEXT.run.chosenDay('2026-08-20')).toContain('2026-08-20')
  })

  it('labels the three figures apart from each other', () => {
    // Read together they are one number; the operator is comparing them.
    const labels = [TEXT.run.target, TEXT.run.alreadyHandled, TEXT.run.estimate]
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
