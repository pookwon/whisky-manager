import { describe, expect, it } from 'vitest'
import { TEXT } from '../../src/shared/text.js'
import { WELCOME_AUTOMATION_ID } from '../../src/shared/automations/catalog.js'
import {
  outcomeSummary,
  progressSummary,
  relativeTime,
  isRefusalStale,
  disabledAutomationNames,
  formatNextSessionTime,
  getBridgeStatusText,
  getBridgeStatusTone,
  warmSummary,
} from '../../src/renderer/format.js'

const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * Expectations name a catalogue entry rather than repeating its Korean, so a
 * reworded string does not fail a test about which entry got picked and what
 * was put into it — which is the behaviour these cover.
 */
describe('relativeTime', () => {
  it('reports anything under a minute as just now', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe(TEXT.time.justNow)
  })

  it('reports minutes', () => {
    expect(relativeTime(NOW - 5 * MINUTE, NOW)).toBe(TEXT.time.minutesAgo(5))
  })

  it('reports hours', () => {
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe(TEXT.time.hoursAgo(3))
  })

  it('reports days', () => {
    expect(relativeTime(NOW - 2 * DAY, NOW)).toBe(TEXT.time.daysAgo(2))
  })

  it('never reports a negative age for a clock skew', () => {
    expect(relativeTime(NOW + 5 * MINUTE, NOW)).toBe(TEXT.time.justNow)
  })
})

describe('outcomeSummary', () => {
  it('says nothing has run yet when there is no outcome', () => {
    expect(outcomeSummary(null)).toEqual({ tone: 'idle', text: TEXT.outcome.never })
  })

  it('surfaces a refusal reason so the operator knows why it is quiet', () => {
    expect(outcomeSummary({ opened: false, reason: 'NO_TEMPLATE' })).toEqual({
      tone: 'warn',
      text: TEXT.outcome.refused.NO_TEMPLATE,
    })
  })

  it('treats being logged out as an alarm, not a warning', () => {
    expect(outcomeSummary({ opened: false, reason: 'NOT_LOGGED_IN' })).toEqual({
      tone: 'alarm',
      text: TEXT.outcome.refused.NOT_LOGGED_IN,
    })
  })

  it('treats a quiet session outside the operating window as normal', () => {
    expect(outcomeSummary({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })).toEqual({
      tone: 'idle',
      text: TEXT.outcome.refused.OUTSIDE_ACTIVE_HOURS,
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
      }),
    ).toEqual({ tone: 'ok', text: TEXT.outcome.ran(3) })
  })

  it('flags a session that produced failures', () => {
    expect(
      outcomeSummary({
        opened: true,
        executed: 1,
        skipped: 0,
        awaitingApproval: 0,
        failed: 2,
      }),
    ).toEqual({ tone: 'alarm', text: TEXT.outcome.ranWithFailures(2) })
  })

  it('names every refusal the session can return', () => {
    // The tone map and the wording map are indexed by the same union, so a
    // reason missing from either is a compile error rather than a blank banner.
    // This walks them anyway, because an empty string would still compile.
    const REASONS = Object.keys(TEXT.outcome.refused) as (keyof typeof TEXT.outcome.refused)[]
    for (const reason of REASONS) {
      const summary = outcomeSummary({ opened: false, reason })
      expect(summary.text, `no wording for ${reason}`).not.toBe('')
    }
  })
})

describe('isRefusalStale', () => {
  it('returns false when outcome is null', () => {
    expect(isRefusalStale(null, true)).toBe(false)
  })

  it('returns false when the outcome was not a refusal', () => {
    const outcome = { opened: true as const, executed: 1, skipped: 0, awaitingApproval: 0, failed: 0 }
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

  it('reads on the cafe\'s clock, which is the one the operator is watching', () => {
    // 2026-08-24 02:16 UTC is 11:16 in Seoul. Shown as 02:16 an operator reads
    // it as the small hours and concludes the tool is idle for the day.
    expect(formatNextSessionTime(Date.UTC(2026, 7, 24, 2, 16))).toBe('11:16')
  })

  it('formats to the minute, dropping seconds', () => {
    const nextSessionMs = NOW + (15 * MINUTE + 30 * 1000)
    expect(formatNextSessionTime(nextSessionMs)).toBe('19:15')
  })

  it('wraps past midnight in Seoul, not past midnight in UTC', () => {
    // 15:30 UTC is 00:30 the next day in Seoul.
    expect(formatNextSessionTime(Date.UTC(2026, 7, 24, 15, 30))).toBe('00:30')
  })
})

describe('getBridgeStatusTone', () => {
  it('gives a live bridge the ok tone', () => {
    expect(getBridgeStatusTone('CONNECTED')).toBe('ok')
  })

  it('gives a cycling worker the warn tone rather than an alarm', () => {
    expect(getBridgeStatusTone('RECONNECTING')).toBe('warn')
  })

  it('treats an absent extension as idle, not as something going wrong', () => {
    expect(getBridgeStatusTone('OFFLINE')).toBe('idle')
  })
})

describe('getBridgeStatusText', () => {
  it('names a connected bridge', () => {
    expect(getBridgeStatusText('CONNECTED')).toBe(TEXT.status.bridgeConnected)
  })

  it('names a bridge waiting to reconnect', () => {
    expect(getBridgeStatusText('RECONNECTING')).toBe(TEXT.status.bridgeReconnecting)
  })

  it('names a bridge that is gone', () => {
    expect(getBridgeStatusText('OFFLINE')).toBe(TEXT.status.bridgeOffline)
  })

  it('tells the three states apart', () => {
    const named = ['CONNECTED', 'RECONNECTING', 'OFFLINE'] as const
    expect(new Set(named.map(getBridgeStatusText)).size).toBe(3)
  })
})

describe('progressSummary', () => {
  it('names the phase when collecting, and the counts once it has read a page', () => {
    expect(progressSummary({ phase: 'COLLECTING' })).toBe(TEXT.progress.collecting)
    expect(progressSummary({ phase: 'COLLECTING', pagesRead: 2, collected: 87 })).toBe(
      TEXT.progress.collectingCounted(2, 87),
    )
  })

  it('counts the post in hand as the current position, not as finished', () => {
    expect(progressSummary({ phase: 'WORKING', done: 0, total: 3, nickname: '왜밤이' })).toBe(
      TEXT.progress.workingOn(1, 3, '왜밤이'),
    )
  })

  it('keeps the backlog distinct from the fresh collection', () => {
    expect(progressSummary({ phase: 'BACKLOG', done: 0, total: 2, nickname: '왕밤이' })).toBe(
      TEXT.progress.backlogOn(1, 2, '왕밤이'),
    )
    expect(progressSummary({ phase: 'BACKLOG', done: 1, total: 2, nickname: null })).toBe(
      TEXT.progress.backlog(2, 2),
    )
  })

  it('drops the name when the post has none', () => {
    expect(progressSummary({ phase: 'WORKING', done: 2, total: 3, nickname: null })).toBe(
      TEXT.progress.working(3, 3),
    )
  })

  it("says something different for a backlog walk than for today's own posts", () => {
    const backlog = progressSummary({ phase: 'BACKLOG', done: 0, total: 4, nickname: null })
    const working = progressSummary({ phase: 'WORKING', done: 0, total: 4, nickname: null })
    expect(backlog).not.toBe(working)
  })
})

describe('warmSummary', () => {
  const KST_13_42 = Date.UTC(2026, 7, 25, 4, 42)

  it('says so plainly before the first check lands', () => {
    // About an hour long after a start, and silence there is what sends an
    // operator looking for a feature that is already running.
    expect(warmSummary(null)).toBe('네이버 세션 · 확인 전')
  })

  it('reads the check on the cafe clock, not the machine one', () => {
    expect(warmSummary({ at: KST_13_42, loggedIn: true })).toBe('네이버 세션 · 13:42 확인')
  })

  it('says the login lapsed rather than just when it last looked', () => {
    expect(warmSummary({ at: KST_13_42, loggedIn: false })).toBe('네이버 세션 · 13:42 로그아웃 상태')
  })
})

describe('disabledAutomationNames', () => {
  it('says nothing while everything is switched on', () => {
    expect(disabledAutomationNames([{ id: WELCOME_AUTOMATION_ID, enabled: true }])).toEqual([])
  })

  it('names the automation that cannot run', () => {
    expect(disabledAutomationNames([{ id: WELCOME_AUTOMATION_ID, enabled: false }])).toEqual([
      TEXT.automation.welcomeComment,
    ])
  })

  it('names an automation the catalogue does not know rather than leaving a gap', () => {
    // A row the dashboard is already showing. Dropping it here would leave the
    // banner counting one thing and the list below it showing another.
    expect(disabledAutomationNames([{ id: 'from-the-future', enabled: false }])).toEqual([
      'from-the-future',
    ])
  })

  it('reads each automation by its own id, not by where it sits', () => {
    // The bug this replaces read position 0 for a switch it then paired with
    // another automation's result.
    expect(
      disabledAutomationNames([
        { id: 'from-the-future', enabled: true },
        { id: WELCOME_AUTOMATION_ID, enabled: false },
      ]),
    ).toEqual([TEXT.automation.welcomeComment])
  })
})
