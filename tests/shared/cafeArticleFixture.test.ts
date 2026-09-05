import { describe, expect, it } from 'vitest'
import {
  cafeArticleListUrl,
  isCafeArticleListEndpoint,
  isCafeArticleListTarget,
  sanitizeCafeArticleFixture,
  sanitizeCafeArticleFixtureText,
} from '../../src/shared/cafeArticleFixture.js'

describe('cafeArticleListUrl', () => {
  it('builds only the confirmed menu=0, 50-row, TIME list request', () => {
    const url = cafeArticleListUrl(12, '0')
    expect(url).toBe(
      'https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles?page=12&pageSize=50&sortBy=TIME&viewType=L',
    )
    expect(isCafeArticleListTarget(url)).toBe(true)
  })

  it('rejects invalid pages and all target variations', () => {
    expect(() => cafeArticleListUrl(0, '0')).toThrow('positive safe integer')
    expect(() => cafeArticleListUrl(1.5, '0')).toThrow('positive safe integer')
    expect(isCafeArticleListTarget('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles?page=1&pageSize=50&sortBy=TIME&viewType=L&debug=1')).toBe(false)
    expect(isCafeArticleListEndpoint('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles?page=1&pageSize=50&sortBy=TIME&viewType=L&debug=1')).toBe(true)
    expect(isCafeArticleListTarget('http://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles?page=1&pageSize=50&sortBy=TIME&viewType=L')).toBe(false)
    expect(isCafeArticleListTarget('https://apis.naver.com.evil.example/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles?page=1&pageSize=50&sortBy=TIME&viewType=L')).toBe(false)
  })

  it('puts the menu into the path, so a board list is the same endpoint with a different menu', () => {
    expect(cafeArticleListUrl(12, '137')).toBe(
      'https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/137/articles?page=12&pageSize=50&sortBy=TIME&viewType=L',
    )
    expect(() => cafeArticleListUrl(1, '')).toThrow('menuId must be digits')
    expect(() => cafeArticleListUrl(1, '1a')).toThrow('menuId must be digits')
  })

  it('recognises the endpoint for any menu, but never another cafe', () => {
    expect(isCafeArticleListEndpoint('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/137/articles?page=1')).toBe(true)
    expect(isCafeArticleListEndpoint('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/1/menus/0/articles?page=1')).toBe(false)
    expect(isCafeArticleListTarget('https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/137/articles?page=1&pageSize=50&sortBy=TIME&viewType=L')).toBe(true)
  })
})

describe('sanitizeCafeArticleFixture', () => {
  it('removes secrets and deterministically masks account, post text, and URL fields', () => {
    const raw = {
      cookie: 'SID=secret-cookie',
      accessToken: 'secret-token',
      articleId: '925512',
      cafeId: '14538121',
      menuName: '해외구입기 & 정보',
      subject: '실제 게시글 제목',
      summary: '실제 게시글 요약',
      writerInfo: {
        memberKey: 'member-key-which-must-never-escape',
        nickName: '실제닉네임',
        profileImageUrl: 'https://phinf.pstatic.net/MjAy/profile.jpg?member=real',
      },
      sameMemberKey: 'member-key-which-must-never-escape',
      duplicate: { memberKey: 'member-key-which-must-never-escape' },
      nullableMemberKey: null,
      readCount: 12,
    }

    const first = sanitizeCafeArticleFixture(raw)
    const second = sanitizeCafeArticleFixture(raw)
    expect(first).toEqual(second)

    const fixture = first as Record<string, unknown>
    expect(fixture.cookie).toBeUndefined()
    expect(fixture.accessToken).toBeUndefined()
    expect(fixture.articleId).toBe('925512')
    expect(fixture.cafeId).toBe('14538121')
    expect(fixture.menuName).toBe('해외구입기 & 정보')
    expect(fixture.readCount).toBe(12)
    expect(fixture.subject).not.toBe(raw.subject)
    expect(fixture.summary).not.toBe(raw.summary)

    const writer = fixture.writerInfo as Record<string, unknown>
    expect(writer.memberKey).toHaveLength(raw.writerInfo.memberKey.length)
    expect(writer.memberKey).not.toBe(raw.writerInfo.memberKey)
    expect(writer.nickName).not.toBe(raw.writerInfo.nickName)
    expect(writer.profileImageUrl).toMatch(/^https:\/\/fixture\.invalid\//)
    expect((fixture.duplicate as Record<string, unknown>).memberKey).toBe(writer.memberKey)
    expect(fixture.sameMemberKey).toBe(writer.memberKey)
    expect(fixture.nullableMemberKey).toBeNull()

    const serialized = JSON.stringify(fixture)
    for (const sensitiveValue of [
      raw.cookie,
      raw.accessToken,
      raw.subject,
      raw.summary,
      raw.writerInfo.memberKey,
      raw.writerInfo.nickName,
      raw.writerInfo.profileImageUrl,
    ]) {
      expect(serialized).not.toContain(sensitiveValue)
    }
  })

  it('writes formatted JSON only after it has parsed and sanitized the input', () => {
    const text = sanitizeCafeArticleFixtureText('{"writerInfo":{"memberKey":"real"},"title":"real title"}')
    expect(text).toMatch(/\n$/)
    expect(text).not.toContain('real title')
    expect(text).not.toContain('"real"')
    expect(() => sanitizeCafeArticleFixtureText('<html>login</html>')).toThrow('not valid JSON')
  })
})
