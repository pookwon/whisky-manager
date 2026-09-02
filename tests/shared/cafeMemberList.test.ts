import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CafeMemberListParseError,
  cafeMemberPageIdentity,
  parseCafeMemberList,
  parseCafeMemberListText,
} from '../../src/shared/cafeMemberList.js'

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/cafe-member-list-sample.json', import.meta.url)), 'utf8'),
)

describe('parseCafeMemberList', () => {
  it('parses members, decodes level names, and converts join dates', () => {
    const page = parseCafeMemberList(sample)
    expect(page.items).toHaveLength(3)
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
    // Distinct from the article identity prefix even for the same keys.
    expect(cafeMemberPageIdentity([])).toMatch(/^fnv1a64:/)
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
