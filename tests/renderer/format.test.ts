import { describe, expect, it } from 'vitest'
import { outcomeSummary, relativeTime } from '../../src/renderer/format.js'

const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

describe('relativeTime', () => {
  it('reports anything under a minute as just now', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toEqual({ key: 'time.justNow', count: 0 })
  })

  it('reports minutes', () => {
    expect(relativeTime(NOW - 5 * MINUTE, NOW)).toEqual({ key: 'time.minutesAgo', count: 5 })
  })

  it('reports hours', () => {
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toEqual({ key: 'time.hoursAgo', count: 3 })
  })

  it('reports days', () => {
    expect(relativeTime(NOW - 2 * DAY, NOW)).toEqual({ key: 'time.daysAgo', count: 2 })
  })

  it('never reports a negative age for a clock skew', () => {
    expect(relativeTime(NOW + 5 * MINUTE, NOW)).toEqual({ key: 'time.justNow', count: 0 })
  })
})

describe('outcomeSummary', () => {
  it('says nothing has run yet when there is no outcome', () => {
    expect(outcomeSummary(null)).toEqual({ tone: 'idle', key: 'outcome.never' })
  })

  it('surfaces a refusal reason so the operator knows why it is quiet', () => {
    expect(outcomeSummary({ opened: false, reason: 'NO_TEMPLATE' })).toEqual({
      tone: 'warn',
      key: 'outcome.refused.NO_TEMPLATE',
    })
  })

  it('treats being logged out as an alarm, not a warning', () => {
    expect(outcomeSummary({ opened: false, reason: 'NOT_LOGGED_IN' })).toEqual({
      tone: 'alarm',
      key: 'outcome.refused.NOT_LOGGED_IN',
    })
  })

  it('treats a quiet session outside the operating window as normal', () => {
    expect(outcomeSummary({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })).toEqual({
      tone: 'idle',
      key: 'outcome.refused.OUTSIDE_ACTIVE_HOURS',
    })
  })

  it('reports a session that ran with what it did', () => {
    expect(
      outcomeSummary({
        opened: true,
        executed: 3,
        skipped: 1,
        awaitingApproval: 0,
        failed: 0,
        expired: 0,
        lastProcessedPostId: '1003',
      }),
    ).toEqual({ tone: 'ok', key: 'outcome.ran', count: 3 })
  })

  it('flags a session that produced failures', () => {
    expect(
      outcomeSummary({
        opened: true,
        executed: 1,
        skipped: 0,
        awaitingApproval: 0,
        failed: 2,
        expired: 0,
        lastProcessedPostId: '1003',
      }),
    ).toEqual({ tone: 'alarm', key: 'outcome.ranWithFailures', count: 2 })
  })
})
