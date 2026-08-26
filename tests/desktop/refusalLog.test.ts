import { describe, expect, it } from 'vitest'
import { formatRefusal } from '../../src/desktop/refusalLog.js'
import { KST_OFFSET_MS } from '../../src/shared/kst.js'

const OPENING = Date.UTC(2026, 7, 26, 10, 0, 0) - KST_OFFSET_MS // 10:00:00.000 KST

describe('formatRefusal', () => {
  it('names the instant the session was judged at, in KST', () => {
    const line = formatRefusal({ reason: 'OUTSIDE_ACTIVE_HOURS', judgedAt: OPENING, wake: null })
    expect(line).toContain('2026-08-26 10:00:00.000 KST')
    expect(line).toContain('OUTSIDE_ACTIVE_HOURS')
    expect(line.endsWith('\n')).toBe(true)
  })

  it('says how far off the wake was when the session opened early', () => {
    // The case this log exists for: a session refused for being outside the
    // window it was itself aimed at. Two milliseconds is enough to do it.
    const line = formatRefusal({
      reason: 'OUTSIDE_ACTIVE_HOURS',
      judgedAt: OPENING - 2,
      wake: { scheduledFor: OPENING, wokeAt: OPENING - 2 },
    })
    expect(line).toContain('2ms early')
    expect(line).toContain('scheduled 2026-08-26 10:00:00.000 KST')
  })

  it('says so when the wake was late instead', () => {
    const line = formatRefusal({
      reason: 'OUTSIDE_ACTIVE_HOURS',
      judgedAt: OPENING + 1_500,
      wake: { scheduledFor: OPENING, wokeAt: OPENING + 1_500 },
    })
    expect(line).toContain('1500ms late')
  })

  it('marks a run nothing scheduled', () => {
    const line = formatRefusal({ reason: 'NOT_LOGGED_IN', judgedAt: OPENING, wake: null })
    expect(line).toContain('unscheduled')
    expect(line).not.toContain('early')
  })

  it('keeps one refusal to one line, so the file stays greppable', () => {
    const line = formatRefusal({
      reason: 'OUTSIDE_ACTIVE_HOURS',
      judgedAt: OPENING,
      wake: { scheduledFor: OPENING, wokeAt: OPENING },
    })
    expect(line.trimEnd().split('\n')).toHaveLength(1)
  })
})
