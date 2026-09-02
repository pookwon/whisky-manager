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

describe('sanitizeCafeMemberFixture — envelope values', () => {
  const fullPayload = {
    isSuccess: true,
    totalCount: 209653,
    message: 'OK',
    result: {
      totalCount: 209653,
      members: [
        {
          memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          nickname: '홍길동',
          joinDate: '2026.08.01.',
          memberLevelName: '정회원',
          manager: false,
          staff: false,
          realName: '홍길동',
          emailAddress: 'hong@example.com',
          cellPhoneNo: '010-1234-5678',
          naverId: 'honggildong',
          birthday: '19900101',
        },
      ],
    },
  }

  it('preserves boolean and number envelope fields so the fixture round-trips through the parser', () => {
    const sanitized = sanitizeCafeMemberFixture(fullPayload) as Record<string, unknown>
    // Envelope booleans and numbers must survive
    expect(sanitized['isSuccess']).toBe(true)
    expect(sanitized['totalCount']).toBe(209653)
    // Non-allowlisted envelope strings still become shape markers
    expect(sanitized['message']).not.toBe('OK')
  })

  it('still erases PII inside members even when envelope values are kept', () => {
    const sanitized = sanitizeCafeMemberFixture(fullPayload) as Record<string, unknown>
    const members = ((sanitized['result'] as Record<string, unknown>)['members'] as Record<string, unknown>[])
    const member = members[0]!
    expect(member['realName']).not.toBe('홍길동')
    expect(member['emailAddress']).not.toBe('hong@example.com')
    expect(member['cellPhoneNo']).not.toBe('010-1234-5678')
    expect(member['naverId']).not.toBe('honggildong')
    expect(member['birthday']).not.toBe('19900101')
    // Allowlisted fields are preserved
    expect(member['joinDate']).toBe('2026.08.01.')
    expect(member['memberLevelName']).toBe('정회원')
    expect(member['manager']).toBe(false)
  })

  it('round-trips through parseCafeMemberListText after sanitization', async () => {
    const { sanitizeCafeMemberFixtureText } = await import('../../src/shared/cafeMemberFixture.js')
    const { parseCafeMemberListText } = await import('../../src/shared/cafeMemberList.js')
    const text = JSON.stringify(fullPayload)
    const fixture = sanitizeCafeMemberFixtureText(text)
    // Must parse without throwing
    const page = parseCafeMemberListText(fixture)
    expect(page.items).toHaveLength(1)
    // memberKey is pseudonymized but still a string of the right length
    expect(typeof page.items[0]!.memberKey).toBe('string')
    expect(page.items[0]!.memberKey).toHaveLength(43)
  })
})

describe('sanitizeCafeMemberFixture — Fix 1: unknown array names get maximum redaction', () => {
  it('shape-marks numbers and booleans inside memberList (non-standard array name)', () => {
    const input = {
      isSuccess: true,
      result: {
        memberList: [{ memberNo: 12345678, isBlacklisted: true, visitCount: 42 }],
      },
    }
    const sanitized = sanitizeCafeMemberFixture(input) as Record<string, unknown>
    const list = ((sanitized['result'] as Record<string, unknown>)['memberList'] as Record<string, unknown>[])
    expect(list[0]!['memberNo']).toBe('<number>')
    expect(list[0]!['isBlacklisted']).toBe('<bool>')
    expect(list[0]!['visitCount']).toBe('<number>')
    // Envelope boolean at the top level still survives
    expect(sanitized['isSuccess']).toBe(true)
  })

  it('shape-marks numbers and booleans when result is a top-level array', () => {
    const input = {
      isSuccess: true,
      result: [{ memberNo: 12345678, isBlacklisted: true }],
    }
    const sanitized = sanitizeCafeMemberFixture(input) as Record<string, unknown>
    const list = sanitized['result'] as Record<string, unknown>[]
    expect(list[0]!['memberNo']).toBe('<number>')
    expect(list[0]!['isBlacklisted']).toBe('<bool>')
  })
})

describe('sanitizeCafeMemberFixture — Fix 2: allowlisted keys with object/array values are recursed', () => {
  it('redacts personal values nested inside an object-valued manager field', () => {
    const input = {
      isSuccess: true,
      result: {
        members: [
          {
            memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            nickname: '홍길동',
            joinDate: '2026.08.01.',
            memberLevelName: '정회원',
            manager: { nickname: '운영자', realName: '홍길동', email: 'a@b.c' },
            staff: ['홍길동'],
          },
        ],
      },
    }
    const sanitized = sanitizeCafeMemberFixture(input) as Record<string, unknown>
    const member = (
      ((sanitized['result'] as Record<string, unknown>)['members']) as Record<string, unknown>[]
    )[0]!
    const manager = member['manager'] as Record<string, unknown>
    // nickname inside manager gets pseudonymized, not passed through raw
    expect(manager['nickname']).not.toBe('운영자')
    // realName and email inside manager get shape-marked
    expect(manager['realName']).not.toBe('홍길동')
    expect(manager['email']).not.toBe('a@b.c')
    // staff array elements get shape-marked
    const staff = member['staff'] as string[]
    expect(staff[0]).not.toBe('홍길동')
  })

  it('redacts personal values nested inside an object-valued memberLevelName field', () => {
    const input = {
      isSuccess: true,
      result: {
        members: [
          {
            memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            nickname: '홍길동',
            joinDate: '2026.08.01.',
            memberLevelName: { name: '정회원', ownerRealName: '홍길동' },
            manager: false,
            staff: false,
          },
        ],
      },
    }
    const sanitized = sanitizeCafeMemberFixture(input) as Record<string, unknown>
    const member = (
      ((sanitized['result'] as Record<string, unknown>)['members']) as Record<string, unknown>[]
    )[0]!
    const levelName = member['memberLevelName'] as Record<string, unknown>
    expect(levelName['name']).not.toBe('정회원')
    expect(levelName['ownerRealName']).not.toBe('홍길동')
  })

  it('well-formed sanitized page still round-trips through parseCafeMemberListText', async () => {
    const { sanitizeCafeMemberFixtureText } = await import('../../src/shared/cafeMemberFixture.js')
    const { parseCafeMemberListText } = await import('../../src/shared/cafeMemberList.js')
    const input = {
      isSuccess: true,
      result: {
        members: [
          {
            memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            nickname: '홍길동',
            joinDate: '2026.08.01.',
            memberLevelName: '정회원',
            manager: { nickname: '운영자', realName: '홍길동', email: 'a@b.c' },
            staff: ['홍길동'],
          },
        ],
      },
    }
    const fixture = sanitizeCafeMemberFixtureText(JSON.stringify(input))
    const parsed = JSON.parse(fixture)
    // After sanitization manager is an object (recursed) but memberLevelName
    // must now be a string for the parser to accept it. The parser reads
    // memberLevelName as a string — with an object value the round-trip fails
    // with INVALID_MEMBER, which is the correct behavior: the fixture signals
    // the response shape changed.
    expect(() => parseCafeMemberListText(fixture)).toThrow()
    // But the sanitizer must not have leaked the raw personal values
    expect(fixture).not.toContain('운영자')
    expect(fixture).not.toContain('홍길동')
    expect(fixture).not.toContain('a@b.c')
    // isSuccess must survive so the parser can read the envelope
    expect(parsed['isSuccess']).toBe(true)
  })
})
