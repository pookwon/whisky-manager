import { describe, expect, it } from 'vitest'
import { matchesJoinPattern } from '../../src/shared/joinPattern.js'
import { joinPatternCsv } from '../../src/shared/joinPatternCsv.js'
import { isStudioIdentityRefusal, parseStudioIdentity, parseStudioJoinPage, recentJoinWindows, type StudioJoinMember } from '../../src/shared/studioJoinList.js'

const member = (over: Partial<StudioJoinMember> = {}): StudioJoinMember => ({
  memberKey: 'key-1',
  memberTag: 'tag1',
  nickname: '봄날낙엽',
  maskedMemberId: 'ab****',
  joinedAt: '2026-10-08T19:37:12.53',
  levelName: '비지터',
  visitCount: 2,
  articleCount: 0,
  commentCount: 1,
  activityStopped: false,
  answers: ['남 / 56세', '네, 확인했습니다', '네, 확인했습니다'],
  ...over,
})

describe('matchesJoinPattern', () => {
  it('needs the spaced age answer and one template sentence twice', () => {
    expect(matchesJoinPattern(['남 / 56세', '네, 숙지했습니다', '네, 숙지했습니다'])).toBe(true)
    expect(matchesJoinPattern(['여 / 28세', '네 알겠습니다 ', '네 알겠습니다'])).toBe(true)
  })

  it('leaves the people each condition alone would catch', () => {
    expect(matchesJoinPattern(['남/37', '네 알겠습니다', '네 알겠습니다'])).toBe(false)
    expect(matchesJoinPattern(['남 / 56세', '네', '네'])).toBe(false)
    expect(matchesJoinPattern(['남 / 56세', '네, 확인했습니다', '네, 알겠습니다'])).toBe(false)
    expect(matchesJoinPattern([])).toBe(false)
  })
})

describe('recentJoinWindows', () => {
  it('covers thirty KST days in contiguous weeks ending today', () => {
    // 2026-11-01 16:00 KST
    const windows = recentJoinWindows(Date.UTC(2026, 10, 1, 7), 30)
    expect(windows[0]).toEqual({ from: '2026-10-03', to: '2026-10-09' })
    expect(windows[windows.length - 1]).toEqual({ from: '2026-10-31', to: '2026-11-01' })
    expect(windows).toHaveLength(5)
  })

  it('reads the day from the KST clock, not the UTC one', () => {
    // 2026-11-01 00:30 KST is still October in UTC.
    expect(recentJoinWindows(Date.UTC(2026, 9, 31, 15, 30), 1)).toEqual([{ from: '2026-11-01', to: '2026-11-01' }])
  })
})

describe('studio answers', () => {
  it('orders join answers by question number', () => {
    const body = JSON.stringify({
      totalCount: 1,
      totalCountExceeded: false,
      members: [
        {
          memberKey: 'k',
          memberTag: 't',
          nickname: 'n',
          maskedMemberId: 'm',
          joinDate: '2026-10-08T19:37:12.53',
          memberLevelName: '비지터',
          visitCount: 1,
          articleCount: 0,
          commentCount: 0,
          activityStopped: true,
          joinAnswers: [
            { itemNo: 2, answer: 'b' },
            { itemNo: 1, answer: 'a' },
          ],
        },
      ],
    })
    expect(parseStudioJoinPage(body).members[0]).toMatchObject({ answers: ['a', 'b'], activityStopped: true })
  })

  it('treats only VERIFIED as passed', () => {
    expect(parseStudioIdentity('{"status":"VERIFIED"}')).toBe(true)
    expect(parseStudioIdentity('{"status":"UNVERIFIED"}')).toBe(false)
  })

  it('tells the identity refusal from any other 403', () => {
    expect(isStudioIdentityRefusal(403, '{"errorCode":"0040116","authMethod":"IAS_POPUP"}')).toBe(true)
    expect(isStudioIdentityRefusal(403, '{"title":"Forbidden"}')).toBe(false)
    expect(isStudioIdentityRefusal(403, '<html>')).toBe(false)
    expect(isStudioIdentityRefusal(200, '{"authMethod":"IAS_POPUP"}')).toBe(false)
  })
})

describe('joinPatternCsv', () => {
  it('starts with a BOM so Excel reads Hangul and writes KST clock text as is', () => {
    const csv = joinPatternCsv([member()])
    expect(csv.startsWith('﻿가입일시,')).toBe(true)
    expect(csv).toContain('2026-10-08 19:37:12,봄날낙엽,tag1')
  })

  it('quotes separators and defuses formulas in member-chosen text', () => {
    const csv = joinPatternCsv([member({ nickname: '=HYPERLINK("x")', answers: ['남 / 56세', '네, 확인했습니다', '네, 확인했습니다'] })])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"네, 확인했습니다"')
  })
})
