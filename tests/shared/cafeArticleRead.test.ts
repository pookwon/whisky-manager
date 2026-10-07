import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CafeArticleListParseError } from '../../src/shared/cafeArticleList.js'
import { cafeRefusalCode, parseCafeArticle, parseCafeArticleText } from '../../src/shared/cafeArticleRead.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
const live = fixture('cafe-article-read-728686.json')
const withArticle = (change: (article: Record<string, unknown>) => void): unknown => {
  const value = JSON.parse(live) as { result: { article: Record<string, unknown> } }
  change(value.result.article)
  return value
}
const codeOf = (run: () => unknown): string | null => {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof CafeArticleListParseError ? error.code : 'OTHER'
  }
}

describe('parseCafeArticle', () => {
  it('reads a live article into the row every walk writes, and says it is no notice', () => {
    expect(parseCafeArticleText('728686', live)).toEqual({ isNotice: false, post: {
      cafeId: '14538121',
      postId: '728686',
      boardId: '137',
      boardName: '국내구입기 & 정보',
      title: '월드컵 홈플러스',
      prefix: '대형마트',
      authorId: 'key-writer',
      authorNickname: '글쓴이',
      postedAt: 1749029333663,
      viewCount: 890,
      commentCount: 1,
      replyCount: null,
      isNotice: false,
    } })
  })

  it('reads a post without a prefix whether headId is left out (928665, live) or 0', () => {
    expect(parseCafeArticle('728686', withArticle((a) => { delete a.head; delete a.headId })).post.prefix).toBeNull()
    expect(parseCafeArticle('728686', withArticle((a) => { delete a.head; a.headId = 0 })).post.prefix).toBeNull()
  })

  it('carries the notice flag beside the post, which itself stays the list\'s shape', () => {
    const notice = parseCafeArticle('728686', withArticle((a) => { a.isNotice = true }))
    expect(notice.isNotice).toBe(true)
    expect(notice.post.isNotice).toBe(false)
  })

  it('reads a comment or view count the cafe answers -1 for as unknown', () => {
    expect(parseCafeArticle('728686', withArticle((a) => { a.commentCount = -1 })).post.commentCount).toBeNull()
    expect(parseCafeArticle('728686', withArticle((a) => { a.readCount = -1 })).post.viewCount).toBeNull()
  })

  it('refuses an answer about another article than the one asked for', () => {
    expect(codeOf(() => parseCafeArticleText('728687', live))).toBe('INVALID_ARTICLE')
  })

  it.each([
    ['a headed article without its head', (a: Record<string, unknown>) => { delete a.head }],
    ['no writer', (a: Record<string, unknown>) => { delete a.writer }],
    ['no board', (a: Record<string, unknown>) => { delete a.menu }],
    ['a board without a name', (a: Record<string, unknown>) => { a.menu = { id: 137, name: null } }],
    ['a time in seconds', (a: Record<string, unknown>) => { a.writeDate = 1749029333 }],
    ['a view count below the unknown sentinel', (a: Record<string, unknown>) => { a.readCount = -2 }],
    ['a comment count below the unknown sentinel', (a: Record<string, unknown>) => { a.commentCount = -2 }],
    ['no notice flag', (a: Record<string, unknown>) => { delete a.isNotice }],
    ['a notice flag that is not a boolean', (a: Record<string, unknown>) => { a.isNotice = 'N' }],
  ])('fails loudly on %s', (_label, change) => {
    expect(codeOf(() => parseCafeArticle('728686', withArticle(change)))).toBe('INVALID_ARTICLE')
  })

  it('fails loudly on an envelope without an article, and on a page that is not JSON', () => {
    expect(codeOf(() => parseCafeArticleText('728686', '{"result":{}}'))).toBe('INVALID_ARTICLE')
    expect(codeOf(() => parseCafeArticleText('728686', '{}'))).toBe('INVALID_ENVELOPE')
    expect(codeOf(() => parseCafeArticleText('728686', '<html>'))).toBe('INVALID_JSON')
  })
})

describe('cafeRefusalCode', () => {
  it('reads the cafe\'s own reason for having no post to give', () => {
    expect(cafeRefusalCode(fixture('cafe-article-read-deleted.json'))).toBe('4003')
    expect(cafeRefusalCode(fixture('cafe-article-read-login.json'))).toBe('0004')
  })

  it.each(['<html>', '', '{}', '{"result":{}}', '{"result":{"errorCode":""}}', '{"result":{"errorCode":4003}}'])('names none in %j', (text) => {
    expect(cafeRefusalCode(text)).toBeNull()
  })
})
