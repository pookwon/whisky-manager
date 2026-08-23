import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MEMBER_PAGE_SIZE, memberListUrl, parseMemberList } from '../../src/shared/members.js'

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/member-list.json', import.meta.url)), 'utf8')

describe('memberListUrl', () => {
  it('sorts by join date, newest first', () => {
    const url = memberListUrl('10000000', 1, MEMBER_PAGE_SIZE)
    expect(url).toContain('search.clubid=10000000')
    expect(url).toContain('search.sortType=0')
    expect(url).toContain('search.sortOrder=0')
    expect(url).toContain('search.page=1')
    expect(url).toContain(`search.perPage=${MEMBER_PAGE_SIZE}`)
  })
})

describe('parseMemberList', () => {
  it('reads the fields the join check needs from a real capture', () => {
    expect(parseMemberList(fixture)).toEqual([
      { memberKey: 'FIXTUREMEMBER01xxxxxxxxxxxxxxxxxxxxxxxxxxxx', joinDate: '2026.08.23.' },
      { memberKey: 'FIXTUREMEMBER02xxxxxxxxxxxxxxxxxxxxxxxxxxxx', joinDate: '2026.08.23.' },
      { memberKey: 'FIXTUREMEMBER03xxxxxxxxxxxxxxxxxxxxxxxxxxxx', joinDate: '2026.08.22.' },
    ])
  })

  // This endpoint answers with a real boolean. The memo comment API answers
  // with the string "true", so the two parsers must not share a check.
  it('rejects an unsuccessful response', () => {
    expect(parseMemberList(JSON.stringify({ isSuccess: false, result: { members: [] } }))).toBeNull()
    expect(parseMemberList(JSON.stringify({ isSuccess: 'true', result: { members: [] } }))).toBeNull()
  })

  it('returns null when the body is not the shape we expect', () => {
    expect(parseMemberList('not json')).toBeNull()
    expect(parseMemberList(JSON.stringify({ isSuccess: true }))).toBeNull()
    expect(parseMemberList(JSON.stringify({ isSuccess: true, result: { members: 'no' } }))).toBeNull()
  })

  it('drops records whose join date is not the shape the cafe sends', () => {
    const body = JSON.stringify({
      isSuccess: true,
      result: {
        members: [
          { memberKey: 'a', joinDate: '2026.08.23.' },
          { memberKey: 'b', joinDate: '2026-08-23' },
          { memberKey: '', joinDate: '2026.08.23.' },
        ],
      },
    })
    expect(parseMemberList(body)).toEqual([{ memberKey: 'a', joinDate: '2026.08.23.' }])
  })

  it('distinguishes an empty page from a failed read', () => {
    expect(parseMemberList(JSON.stringify({ isSuccess: true, result: { members: [] } }))).toEqual([])
  })
})
