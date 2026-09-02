import { describe, expect, it } from 'vitest'
import {
  CAFE_MEMBER_LIST,
  cafeMemberListUrl,
  isCafeMemberListEndpoint,
  isCafeMemberListTarget,
  sanitizeCafeMemberFixture,
} from '../../src/shared/cafeMemberFixture.js'

describe('cafeMemberFixture', () => {
  it('builds the exact management list URL for a page', () => {
    const url = cafeMemberListUrl(3)
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://cafe.naver.com')
    expect(parsed.pathname).toBe('/ManageMemberListViewAjax.nhn')
    expect(parsed.searchParams.get('search.clubid')).toBe(CAFE_MEMBER_LIST.cafeId)
    expect(parsed.searchParams.get('search.page')).toBe('3')
    expect(parsed.searchParams.get('search.perPage')).toBe('100')
    expect(parsed.searchParams.get('search.searchType')).toBe('0')
    expect(parsed.searchParams.get('search.memberLevel')).toBe('0')
    expect(parsed.searchParams.get('search.sortType')).toBe('0')
    expect(parsed.searchParams.get('search.sortOrder')).toBe('0')
    expect(parsed.searchParams.get('search.paginationCached')).toBe('false')
    expect(parsed.searchParams.get('search.totalCountCached')).toBe('0')
  })

  it('rejects non-positive and unsafe pages', () => {
    expect(() => cafeMemberListUrl(0)).toThrow()
    expect(() => cafeMemberListUrl(-1)).toThrow()
    expect(() => cafeMemberListUrl(1.5)).toThrow()
  })

  it('accepts only the exact endpoint and fixed query', () => {
    expect(isCafeMemberListEndpoint(cafeMemberListUrl(1))).toBe(true)
    expect(isCafeMemberListTarget(cafeMemberListUrl(1))).toBe(true)
    expect(isCafeMemberListTarget('https://cafe.naver.com/ManageMemberListViewAjax.nhn?search.page=1')).toBe(false)
    expect(isCafeMemberListTarget('https://apis.naver.com/x')).toBe(false)
    expect(isCafeMemberListEndpoint('not a url')).toBe(false)
  })
})

describe('sanitizeCafeMemberFixture', () => {
  const piiInput = {
    isSuccess: true,
    result: {
      members: [
        {
          memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          nickname: '홍길동',
          joinDate: '20260801',
          memberLevelName: '정회원',
          manager: false,
          staff: false,
          // PII fields that must NOT survive in their original form
          realName: '홍길동',
          emailAddress: 'hong@example.com',
          cellPhoneNo: '010-1234-5678',
          phoneNo: '02-000-0000',
          naverId: 'honggildong',
          userDisplayId: 'honggildong',
          birthday: '19900101',
          memberIdMask: 'hong****',
          extraNested: { secret: 'very-secret', count: 99 },
        },
      ],
    },
  }

  function firstMember(input: unknown): Record<string, unknown> {
    const result = sanitizeCafeMemberFixture(input) as Record<string, unknown>
    const members = (result['result'] as Record<string, unknown>)['members'] as Record<string, unknown>[]
    return members[0] as Record<string, unknown>
  }

  it('keeps only the allowlisted keys at their original values', () => {
    const member = firstMember(piiInput)
    // Allowlisted non-identity fields pass through
    expect(member['joinDate']).toBe('20260801')
    expect(member['memberLevelName']).toBe('정회원')
    expect(member['manager']).toBe(false)
    expect(member['staff']).toBe(false)
  })

  it('pseudonymizes memberKey and nickname preserving length', () => {
    const member = firstMember(piiInput)
    const key = member['memberKey'] as string
    const nick = member['nickname'] as string
    // Length-preserving pseudonym
    expect(key).toHaveLength(43)
    expect(nick).toHaveLength(3)
    // Not the original values
    expect(key).not.toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(nick).not.toBe('홍길동')
  })

  it('replaces PII field values with shape markers, keeping the keys', () => {
    const member = firstMember(piiInput)
    // Keys must still exist (the point is to learn what the API sends)
    expect('realName' in member).toBe(true)
    expect('emailAddress' in member).toBe(true)
    expect('cellPhoneNo' in member).toBe(true)
    expect('phoneNo' in member).toBe(true)
    expect('naverId' in member).toBe(true)
    expect('userDisplayId' in member).toBe(true)
    expect('birthday' in member).toBe(true)
    expect('memberIdMask' in member).toBe(true)
    // None of their original string values survive
    expect(member['realName']).not.toBe('홍길동')
    expect(member['emailAddress']).not.toBe('hong@example.com')
    expect(member['cellPhoneNo']).not.toBe('010-1234-5678')
    expect(member['naverId']).not.toBe('honggildong')
    expect(member['birthday']).not.toBe('19900101')
    expect(member['memberIdMask']).not.toBe('hong****')
    // Nested non-allowlisted objects are shape-replaced
    const nested = member['extraNested'] as Record<string, unknown>
    expect(nested['secret']).not.toBe('very-secret')
    expect(nested['count']).toBe('<number>')
  })

  it('produces the same pseudonym for the same memberKey across calls (deterministic)', () => {
    const a = sanitizeCafeMemberFixture(piiInput) as Record<string, unknown>
    const b = sanitizeCafeMemberFixture(piiInput) as Record<string, unknown>
    const keyA = ((a['result'] as Record<string, unknown>)['members'] as Record<string, unknown>[])[0]?.['memberKey']
    const keyB = ((b['result'] as Record<string, unknown>)['members'] as Record<string, unknown>[])[0]?.['memberKey']
    expect(keyA).toBe(keyB)
  })
})
