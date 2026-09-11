import { describe, expect, it } from 'vitest'
import { formatSessionLine } from '../../src/desktop/sessionLog.js'
import { kstDayStartMs } from '../../src/shared/kst.js'

const T0 = Date.UTC(2026, 8, 11, 5, 3, 12, 418) // 14:03:12.418 KST
const MS_PER_DAY = 86_400_000
const opened = { opened: true, executed: 9, skipped: 2, awaitingApproval: 0, failed: 0 } as const

describe('formatSessionLine', () => {
  it('writes an opened session on one line', () => {
    expect(
      formatSessionLine({
        automationId: 'prefix-reminder',
        mode: 'SCHEDULED',
        outcome: opened,
        openedAt: T0 - 372_000,
        endedAt: T0,
        wake: null,
        days: [
          {
            dayStartMs: kstDayStartMs(T0),
            pages: 7,
            read: 312,
            tally: { read: 312, eligible: 11, droppedBy: { HAS_PREFIX: 289, EXCLUDED_BOARD: 10, AUTHOR_IS_OPERATOR: 2 } },
          },
        ],
      }),
    ).toBe(
      '2026-09-11 14:03:12.418 KST  prefix-reminder  SCHEDULED  opened  day=09-11 pages=7 read=312 eligible=11 dropped[HAS_PREFIX=289 EXCLUDED_BOARD=10 AUTHOR_IS_OPERATOR=2]  executed=9 skipped=2 awaiting=0 failed=0  took=6m12s\n',
    )
  })

  it('omits the eligibility part for a collector that does not screen', () => {
    const line = formatSessionLine({
      automationId: 'welcome-comment',
      mode: 'SCHEDULED',
      outcome: { ...opened, executed: 3, skipped: 11 },
      openedAt: T0 - 160_000,
      endedAt: T0,
      wake: null,
      days: [{ dayStartMs: kstDayStartMs(T0), pages: 1, read: 14, tally: null }],
    })
    expect(line).toBe(
      '2026-09-11 14:03:12.418 KST  welcome-comment  SCHEDULED  opened  day=09-11 pages=1 read=14  executed=3 skipped=11 awaiting=0 failed=0  took=2m40s\n',
    )
  })

  it('writes two day summaries when a session settled yesterday first', () => {
    const line = formatSessionLine({
      automationId: 'prefix-reminder',
      mode: 'SCHEDULED',
      outcome: opened,
      openedAt: T0 - 372_000,
      endedAt: T0,
      wake: null,
      days: [
        { dayStartMs: kstDayStartMs(T0) - MS_PER_DAY, pages: 2, read: 40, tally: null },
        { dayStartMs: kstDayStartMs(T0), pages: 7, read: 312, tally: null },
      ],
    })
    expect(line).toContain('day=09-10 pages=2 read=40 / day=09-11 pages=7 read=312')
  })

  it('writes a refusal with the automation in front', () => {
    expect(
      formatSessionLine({
        automationId: 'prefix-reminder',
        mode: 'SCHEDULED',
        outcome: { opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' },
        openedAt: T0,
        endedAt: T0,
        days: [],
        wake: { scheduledFor: T0 - 8002, wokeAt: T0 },
      }),
    ).toBe(
      '2026-09-11 14:03:12.418 KST  prefix-reminder  SCHEDULED  refused OUTSIDE_ACTIVE_HOURS  scheduled 2026-09-11 14:03:04.416 KST  woke 8002ms late\n',
    )
  })
})
