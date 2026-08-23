import { describe, expect, it } from 'vitest'
import {
  outcomeSummary,
  progressSummary,
  relativeTime,
  isRefusalStale,
  formatNextSessionTime,
  getBridgeStatusKey,
} from '../../src/renderer/format.js'

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
      }),
    ).toEqual({ tone: 'alarm', key: 'outcome.ranWithFailures', count: 2 })
  })
})

describe('isRefusalStale', () => {
  it('returns false when outcome is null', () => {
    expect(isRefusalStale(null, true)).toBe(false)
  })

  it('returns false when the outcome was not a refusal', () => {
    const outcome = { opened: true as const, executed: 1, skipped: 0, awaitingApproval: 0, failed: 0, expired: 0 }
    expect(isRefusalStale(outcome, true)).toBe(false)
  })

  it('returns true when refused as DISABLED but automation is now enabled', () => {
    const outcome = { opened: false as const, reason: 'DISABLED' as const }
    expect(isRefusalStale(outcome, true)).toBe(true)
  })

  it('returns false when refused as DISABLED but automation is still disabled', () => {
    const outcome = { opened: false as const, reason: 'DISABLED' as const }
    expect(isRefusalStale(outcome, false)).toBe(false)
  })

  it('returns false when refused for other reasons', () => {
    const outcome = { opened: false as const, reason: 'NOT_LOGGED_IN' as const }
    expect(isRefusalStale(outcome, true)).toBe(false)
  })
})

describe('formatNextSessionTime', () => {
  it('returns null when nextSessionAt is null', () => {
    expect(formatNextSessionTime(null)).toBe(null)
  })

  it('formats next session time as HH:MM', () => {
    // 10:15 in milliseconds = 10*3600*1000 + 15*60*1000
    const nextSessionMs = NOW + (15 * MINUTE + 30 * 1000) // 15 min 30 sec later
    const result = formatNextSessionTime(nextSessionMs)
    expect(result).toBe('10:15')
  })

  it('handles session time on next day', () => {
    const nextSessionMs = NOW + DAY + (14 * HOUR + 30 * MINUTE)
    const result = formatNextSessionTime(nextSessionMs)
    expect(result).toBe('00:30')
  })
})

describe('getBridgeStatusKey', () => {
  it('returns connected key when status is CONNECTED', () => {
    expect(getBridgeStatusKey('CONNECTED')).toBe('status.bridgeConnected')
  })

  it('returns reconnecting key when status is RECONNECTING', () => {
    expect(getBridgeStatusKey('RECONNECTING')).toBe('status.bridgeReconnecting')
  })

  it('returns offline key when status is OFFLINE', () => {
    expect(getBridgeStatusKey('OFFLINE')).toBe('status.bridgeOffline')
  })
})

describe('progressSummary', () => {
  it('names the phase when collecting', () => {
    expect(progressSummary({ phase: 'COLLECTING' })).toEqual({ key: 'progress.COLLECTING', values: {} })
  })

  it('counts the post in hand as the current position, not as finished', () => {
    expect(
      progressSummary({ phase: 'WORKING', done: 0, total: 3, nickname: '\uc65c\ubc24\uc774' }),
    ).toEqual({
      key: 'progress.workingOn',
      values: { position: 1, total: 3, nickname: '\uc65c\ubc24\uc774' },
    })
  })

  it('keeps the backlog distinct from the fresh collection', () => {
    expect(
      progressSummary({ phase: 'BACKLOG', done: 0, total: 2, nickname: '\uc655\ubc24\uc774' }),
    ).toEqual({
      key: 'progress.backlogOn',
      values: { position: 1, total: 2, nickname: '\uc655\ubc24\uc774' },
    })
    expect(progressSummary({ phase: 'BACKLOG', done: 1, total: 2, nickname: null })).toEqual({
      key: 'progress.backlog',
      values: { position: 2, total: 2 },
    })
  })

  it('drops the name when the post has none', () => {
    expect(progressSummary({ phase: 'WORKING', done: 2, total: 3, nickname: null })).toEqual({
      key: 'progress.working',
      values: { position: 3, total: 3 },
    })
  })
})
