/**
 * Logic tests for the attendance records screen's derived display values.
 * These test the pure functions exported from attendanceRecords.ts directly,
 * without mounting the component.
 */
import { describe, expect, it } from 'vitest'
import { TEXT } from '../../src/shared/text.js'
import type { AttendanceProgress, AttendanceStatus } from '../../src/desktop/ipc.js'
import {
  databaseNotice,
  kindRows,
  progressSentence,
  refusedLines,
  showStopButton,
  startRefusalSentence,
} from '../../src/renderer/views/attendanceRecords.js'

/** The Task 5 status example: one comment round, no post rounds, two visit rounds, one refused post. */
const status: AttendanceStatus = {
  kinds: [
    { kind: 'comment', roundCount: 1, awardCount: 2, earliest: { startDay: '2026-11-01', endDay: '2026-11-10' }, latest: { startDay: '2026-11-01', endDay: '2026-11-10' } },
    { kind: 'post', roundCount: 0, awardCount: 0, earliest: null, latest: null },
    { kind: 'visit', roundCount: 2, awardCount: 4, earliest: { startDay: '2021-03-01', endDay: '2021-03-11' }, latest: { startDay: '2026-11-01', endDay: '2026-11-10' } },
  ],
  refused: [{ postId: '412345', title: '[댓글 개근] 이번 회차 안내', rule: 'PERIOD_UNREADABLE' }],
  lastReadAtMs: null,
}

const idle: AttendanceProgress = { state: 'idle', listPage: 0, postsTotal: 0, postsRead: 0, failureCode: null }

/** Cells of one kind row as the table joins them, left to right. */
function cells(row: { rounds: string; awards: string; earliest: string; latest: string }): string {
  return [row.rounds, row.awards, row.earliest, row.latest].join(' / ')
}

describe('attendance records — kindRows', () => {
  it('shows three rows in the order 댓글, 게시글, 방문', () => {
    const rows = kindRows(status.kinds)
    expect(rows.map((row) => row.kind)).toEqual(['댓글', '게시글', '방문'])
  })

  it('shows rounds, awards and both periods for each kind', () => {
    const rows = kindRows(status.kinds)
    expect(rows.map(cells)).toEqual([
      '1 / 2 / 2026-11-01 ~ 2026-11-10 / 2026-11-01 ~ 2026-11-10',
      '0 / 0 / - / -',
      '2 / 4 / 2021-03-01 ~ 2021-03-11 / 2026-11-01 ~ 2026-11-10',
    ])
  })
})

describe('attendance records — refusedLines', () => {
  it('names each refused post and translates its rule', () => {
    const lines = refusedLines(status.refused)
    expect(lines).toEqual([
      { postId: '412345', title: '[댓글 개근] 이번 회차 안내', rule: '기간을 읽지 못함' },
    ])
  })

  it('shows an unnamed rule as itself', () => {
    const lines = refusedLines([{ postId: '1', title: 't', rule: 'FUTURE_RULE' }])
    expect(lines.map((line) => line.rule)).toEqual(['FUTURE_RULE'])
  })
})

describe('attendance records — progressSentence and buttons', () => {
  it('reads the post counter while reading, and offers the stop button', () => {
    const progress: AttendanceProgress = { state: 'reading', listPage: 3, postsTotal: 600, postsRead: 12, failureCode: null }
    expect(progressSentence(progress)).toBe('글 12 / 600')
    expect(showStopButton(progress)).toBe(true)
  })

  it('offers the start button while idle', () => {
    expect(showStopButton(idle)).toBe(false)
    expect(progressSentence(idle)).toBeNull()
  })

  it('reports the list page while listing', () => {
    const progress: AttendanceProgress = { state: 'listing', listPage: 4, postsTotal: 0, postsRead: 0, failureCode: null }
    expect(progressSentence(progress)).toBe(TEXT.attendance.listing(4))
    expect(showStopButton(progress)).toBe(true)
  })

  it('reports the run outcome when done, stopped or failed', () => {
    expect(progressSentence({ ...idle, state: 'done', postsRead: 7 })).toBe(TEXT.attendance.done(7))
    expect(progressSentence({ ...idle, state: 'stopped' })).toBe(TEXT.attendance.stopped)
    expect(progressSentence({ ...idle, state: 'failed', failureCode: 'READ_TIMEOUT' })).toBe(TEXT.attendance.failed('READ_TIMEOUT'))
  })
})

describe('attendance records — database and start notices', () => {
  it('says the database is not configured when there is no status', () => {
    expect(databaseNotice(null)).toBe('수집 DB가 설정되어 있지 않습니다.')
    expect(databaseNotice(status)).toBeNull()
  })

  it('translates a start that was refused, and says nothing when it started', () => {
    expect(startRefusalSentence('COLLECTION_BUSY')).toBe(TEXT.attendance.notStarted.COLLECTION_BUSY)
    expect(startRefusalSentence('STARTED')).toBeNull()
  })
})
