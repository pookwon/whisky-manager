import { describe, expect, it } from 'vitest'
import { parseAttendanceTitle } from '../../src/shared/attendanceTitle.js'

const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 22, 2) // 07:02 KST the next day

describe('parseAttendanceTitle', () => {
  it('reads the kind and the period, taking the year from the post', () => {
    expect(parseAttendanceTitle('[댓글 개근] 11월 1일~11월 10일 카페 댓글 개근상을 잡아라!', at(2026, 11, 10)))
      .toEqual({ kind: 'attendance', attendanceKind: 'comment', period: { startDay: '2026-11-01', endDay: '2026-11-10' } })
    expect(parseAttendanceTitle('[방문 개근] 3월 1일~3월 11일 카페 방문 개근상을 잡아라!', at(2021, 3, 11)))
      .toEqual({ kind: 'attendance', attendanceKind: 'visit', period: { startDay: '2021-03-01', endDay: '2021-03-11' } })
    expect(parseAttendanceTitle('[게시글 개근] 10월 16일~10월 26일 카페 게시글 개근상을 잡아라!', at(2021, 10, 26)))
      .toEqual({ kind: 'attendance', attendanceKind: 'post', period: { startDay: '2021-10-16', endDay: '2021-10-26' } })
  })

  it('puts a round that ends on the last day of the year in that year', () => {
    expect(parseAttendanceTitle('[댓글 개근] 12월 21일~12월 31일 카페', at(2024, 12, 31)))
      .toMatchObject({ period: { startDay: '2024-12-21', endDay: '2024-12-31' } })
  })

  it('starts a round that crosses the year in the year before', () => {
    expect(parseAttendanceTitle('[게시글 개근] 12월 22일~1월 1일 카페', at(2024, 1, 1)))
      .toMatchObject({ period: { startDay: '2023-12-22', endDay: '2024-01-01' } })
  })

  it('calls every other post of the board other', () => {
    for (const title of ['[월간MoM]10월 Member of the Month 발표 - 30명', '[이주의 인기멤버]이주의 인기멤버 11.02-11.08', '[방문 히트] 1000000번째 방문', '개근상 안내', null]) {
      expect(parseAttendanceTitle(title, at(2026, 11, 10))).toEqual({ kind: 'other' })
    }
  })

  it('keeps an attendance post whose period it cannot read, without a period', () => {
    const unreadable = { kind: 'attendance', attendanceKind: 'comment', period: null }
    expect(parseAttendanceTitle('[댓글 개근] 이번 회차 안내', at(2026, 11, 10))).toEqual(unreadable)
    expect(parseAttendanceTitle('[댓글 개근] 2월 21일~2월 30일 카페', at(2026, 3, 1))).toEqual(unreadable)
    // Ended more than seven days before the post: the year would be a guess.
    expect(parseAttendanceTitle('[댓글 개근] 3월 1일~3월 11일 카페', at(2021, 3, 25))).toEqual(unreadable)
  })
})
