import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CafeMemberListParseError,
  cafeMemberPageIdentity,
  parseCafeMemberList,
  parseCafeMemberListText,
} from '../../src/shared/cafeMemberList.js'
import { cafeArticlePageIdentity } from '../../src/shared/cafeArticleList.js'

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8'),
  )
}

const sample = loadFixture('cafe-member-list-sample.json')

/** Marker pattern: any value the sanitizer left as a placeholder. */
const MARKER_RE = /^<[A-Za-z0-9_/:]+>$/

describe('real fixture sanity', () => {
  const PARSER_KEYS = new Set(['memberKey', 'nickname', 'joinDate', 'memberLevelName', 'manager', 'staff'])
  for (const name of ['cafe-member-list-page-1.json', 'cafe-member-list-page-1000.json', 'cafe-member-list-page-2096.json', 'cafe-member-list-page-2097.json', 'cafe-member-list-page-2098.json']) {
    it(`${name} has no raw strings outside the six parser keys`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fixture: any = loadFixture(name)
      const mems: unknown[] = fixture.result.members
      for (const [i, m] of mems.entries()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const [k, v] of Object.entries(m as any)) {
          if (PARSER_KEYS.has(k)) continue
          if (typeof v === 'string') {
            expect(MARKER_RE.test(v), `[${i}].${k} = ${JSON.stringify(v)} is not a marker`).toBe(true)
          }
        }
      }
    })
  }
})

describe('real fixture parsing', () => {
  it('page 1 parses 100 items with totalMemberCount 209584 and decodes 비지터', () => {
    const page = parseCafeMemberList(loadFixture('cafe-member-list-page-1.json'))
    expect(page.items).toHaveLength(100)
    expect(page.totalMemberCount).toBe(209584)
    expect(page.items[0]?.levelName).toBe('비지터')
  })

  it('page 2097 parses 13 items (last real page)', () => {
    const page = parseCafeMemberList(loadFixture('cafe-member-list-page-2097.json'))
    expect(page.items).toHaveLength(13)
    expect(page.totalMemberCount).toBe(209584)
  })

  it('page 2098 parses 1 item (past-end fallback repeats last member)', () => {
    const page = parseCafeMemberList(loadFixture('cafe-member-list-page-2098.json'))
    expect(page.items).toHaveLength(1)
  })

  for (const name of ['cafe-member-list-page-1.json', 'cafe-member-list-page-1000.json', 'cafe-member-list-page-2096.json', 'cafe-member-list-page-2097.json']) {
    it(`${name} join dates are non-increasing`, () => {
      const page = parseCafeMemberList(loadFixture(name))
      let previous: string | null = null
      for (const item of page.items) {
        if (previous !== null) expect(item.joinDate <= previous).toBe(true)
        previous = item.joinDate
      }
    })
  }
})

describe('parseCafeMemberList', () => {
  it('parses members, decodes level names, and converts join dates', () => {
    const page = parseCafeMemberList(sample)
    expect(page.items).toHaveLength(3)
    expect(page.totalMemberCount).toBe(12345)
    expect(page.items[0]).toEqual({
      memberKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      nickname: '새회원하나',
      joinDate: '2026-08-23',
      levelName: '정물&<>',
      isManager: false,
      isStaff: false,
    })
    expect(page.items[1]?.nickname).toBeNull()
    expect(page.items[1]?.levelName).toBe('"VIP"')
    expect(page.items[2]?.isStaff).toBe(true)
  })

  it('gives a deterministic, order-independent identity', () => {
    const a = cafeMemberPageIdentity(['k2', 'k1', 'k3'])
    const b = cafeMemberPageIdentity(['k3', 'k2', 'k1'])
    expect(a).toBe(b)
    expect(a).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(cafeMemberPageIdentity(['k1'])).not.toBe(cafeMemberPageIdentity(['k2']))
    // Distinct from the article identity for the same key set because the canonical
    // string embeds the feed name; the same keys must not produce the same hash.
    expect(cafeMemberPageIdentity(['k1', 'k2'])).not.toBe(cafeArticlePageIdentity(['k1', 'k2']))
  })

  it('rejects a whole page on any contract violation', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = (mutate: (value: any) => void, code: string) => {
      const clone = JSON.parse(JSON.stringify(sample))
      mutate(clone)
      try {
        parseCafeMemberList(clone)
        throw new Error('expected rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(CafeMemberListParseError)
        expect((error as CafeMemberListParseError).code).toBe(code)
      }
    }
    bad((v) => { v.isSuccess = 'true' }, 'NOT_SUCCESS')
    bad((v) => { v.isSuccess = false }, 'NOT_SUCCESS')
    bad((v) => { v.result.members = {} }, 'INVALID_ENVELOPE')
    bad((v) => { v.result.members[0].memberKey = 42 }, 'INVALID_MEMBER')
    bad((v) => { v.result.members[0].joinDate = '2026-08-23' }, 'INVALID_MEMBER')
    bad((v) => { v.result.members[0].manager = 'no' }, 'INVALID_MEMBER')
    bad((v) => { v.result.members[1].memberKey = v.result.members[0].memberKey }, 'DUPLICATE_MEMBER_KEY')
  })

  it('rejects non-JSON without treating an HTML login page as an empty list', () => {
    try {
      parseCafeMemberListText('<html>login</html>')
      throw new Error('expected rejection')
    } catch (error) {
      expect((error as CafeMemberListParseError).code).toBe('INVALID_JSON')
    }
  })
})
