import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  articleCommentListRequest,
  articleCommentListUrl,
  articleCommentWriteRequest,
  parseArticleCommentAuthors,
  parseArticleCommentPage,
} from '../../../../src/shared/automations/prefix-reminder/articleCafe.js'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/article-comments-${name}.json`, import.meta.url)), 'utf8')

const source = { cafeId: '14538121', boardId: '36' }

/** The capture, with the first comment marked as deleted. */
function withFirstCommentDeleted(): string {
  const payload = JSON.parse(fixture('some')) as {
    result: { comments: { items: { isDeleted: boolean }[] } }
  }
  const [first, ...rest] = payload.result.comments.items
  if (first === undefined) throw new Error('fixture has no comments')
  return JSON.stringify({
    ...payload,
    result: {
      ...payload.result,
      comments: { ...payload.result.comments, items: [{ ...first, isDeleted: true }, ...rest] },
    },
  })
}

describe('parseArticleCommentAuthors', () => {
  it('lists nickname and member key of every live comment', () => {
    expect(parseArticleCommentAuthors(fixture('some'))).toEqual([
      { nickname: '회원A', memberKey: 'key-a' },
      { nickname: '회원B', memberKey: 'key-b' },
      // A sticker-only comment has empty content but a writer like any other.
      { nickname: '회원C', memberKey: 'key-c' },
      { nickname: '카페 스탭', memberKey: 'key-operator' },
    ])
  })

  it('returns an empty list for a post nobody commented on', () => {
    expect(parseArticleCommentAuthors(fixture('none'))).toEqual([])
  })

  it('leaves deleted comments out', () => {
    expect(parseArticleCommentAuthors(withFirstCommentDeleted())).toEqual([
      { nickname: '회원B', memberKey: 'key-b' },
      { nickname: '회원C', memberKey: 'key-c' },
      { nickname: '카페 스탭', memberKey: 'key-operator' },
    ])
  })

  it('returns null for anything that is not the comment response', () => {
    expect(parseArticleCommentAuthors('<html>login</html>')).toBeNull()
    expect(parseArticleCommentAuthors('{}')).toBeNull()
    expect(parseArticleCommentAuthors(JSON.stringify({ result: { comments: {} } }))).toBeNull()
  })
})

describe('parseArticleCommentPage', () => {
  it('names the member the session belongs to alongside the comments', () => {
    expect(parseArticleCommentPage(fixture('some'))?.viewerMemberKey).toBe('key-operator')
    expect(parseArticleCommentPage(fixture('none'))?.viewerMemberKey).toBe('key-operator')
  })

  it('reports no viewer when the response names none', () => {
    const anonymous = JSON.stringify({ result: { comments: { items: [] } } })

    expect(parseArticleCommentPage(anonymous)).toEqual({ viewerMemberKey: null, authors: [] })
  })

  it('returns null when the response is not the comment page', () => {
    expect(parseArticleCommentPage('<html>login</html>')).toBeNull()
  })
})

describe('urls and requests', () => {
  it('builds the list url the contract names', () => {
    expect(articleCommentListUrl(source, '998877', 1)).toBe(
      'https://article.cafe.naver.com/gw/v4/cafes/14538121/articles/998877/comments/pages/1?requestFrom=A&orderBy=asc',
    )
  })

  it('reads the list as the article page itself would', () => {
    const request = articleCommentListRequest(source, '998877')

    expect(request.url).toBe(articleCommentListUrl(source, '998877', 1))
    expect(request.method).toBeUndefined()
    expect(request.referer).toBe('https://cafe.naver.com/ca-fe/cafes/14538121/articles/998877')
    expect(request.headers).toEqual({ 'x-cafe-product': 'pc' })
  })

  it('builds the write request field for field', () => {
    const request = articleCommentWriteRequest(source, '998877', '말머리를 골라 주세요')

    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://apis.naver.com/cafe-web/cafe-mobile/CommentPost.json')
    expect(request.contentType).toBe('application/x-www-form-urlencoded')
    expect(request.referer).toBe('https://cafe.naver.com/ca-fe/cafes/14538121/articles/998877')
    expect(request.headers).toEqual({ 'x-cafe-product': 'pc' })

    const fields = new URLSearchParams(request.body ?? '')
    expect([...fields.keys()]).toEqual(['content', 'stickerId', 'cafeId', 'articleId', 'requestFrom'])
    expect(fields.get('content')).toBe('말머리를 골라 주세요')
    expect(fields.get('stickerId')).toBe('')
    expect(fields.get('cafeId')).toBe('14538121')
    expect(fields.get('articleId')).toBe('998877')
    expect(fields.get('requestFrom')).toBe('A')
  })

  it('encodes the comment as utf-8, unlike the memo board which is ms949', () => {
    const request = articleCommentWriteRequest(source, '998877', '말머리')

    expect(request.body).toContain('content=%EB%A7%90%EB%A8%B8%EB%A6%AC')
  })

  it('percent-encodes a space, byte for byte as the capture sent it', () => {
    // The capture is the authority on what goes on the wire. A form body may
    // spell a space as `+`, and the endpoint would very likely take it, but
    // "very likely" is not what the contract records.
    const request = articleCommentWriteRequest(source, '998877', 'a b')

    expect(request.body).toBe('content=a%20b&stickerId=&cafeId=14538121&articleId=998877&requestFrom=A')
  })
})
