import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpResponse } from '../../src/shared/http.js'
import { createArticleClient } from '../../src/extension/articleClient.js'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/article-comments-${name}.json`, import.meta.url)), 'utf8')

const source = { cafeId: '14538121', boardId: '36' }
const postId = '998877'

/** The capture as seen by a given session. `null` is a signed-out visitor. */
function seenBy(viewerMemberKey: string | null): string {
  const payload = JSON.parse(fixture('some')) as { result: { user: Record<string, unknown> } }
  return JSON.stringify({
    ...payload,
    result: { ...payload.result, user: { ...payload.result.user, memberKey: viewerMemberKey ?? undefined } },
  })
}

const ok = (text: string): HttpResponse => ({ status: 200, contentType: 'application/json', text })

const AUTHORS = [
  { nickname: '회원A', memberKey: 'key-a' },
  { nickname: '회원B', memberKey: 'key-b' },
  { nickname: '회원C', memberKey: 'key-c' },
  { nickname: '카페 스탭', memberKey: 'key-operator' },
]

/** The write endpoint answers with the new comment's id and nothing else. */
const POSTED = ok('{"commentId":103843785,"refCommentId":103843785}')

interface Route {
  readonly match: (request: HttpRequest) => boolean
  readonly reply: HttpResponse
}

function harness(routes: Route[], fallback: HttpResponse = ok('')) {
  const seen: HttpRequest[] = []
  const client = createArticleClient({
    http: (request) => {
      seen.push(request)
      return Promise.resolve(routes.find((r) => r.match(request))?.reply ?? fallback)
    },
  })
  return { client, seen }
}

const isRead = (request: HttpRequest): boolean => request.url.includes('/comments/pages/')
const isWrite = (request: HttpRequest): boolean => request.method === 'POST'

describe('checkComments', () => {
  it('reads who commented', async () => {
    const { client, seen } = harness([{ match: isRead, reply: ok(fixture('some')) }])

    expect(await client.checkComments(source, postId)).toEqual(AUTHORS)
    expect(seen[0]?.headers).toEqual({ 'x-cafe-product': 'pc' })
    expect(seen[0]?.referer).toBe('https://cafe.naver.com/ca-fe/cafes/14538121/articles/998877')
  })

  it('separates a post nobody commented on from a thread it could not read', async () => {
    const { client: empty } = harness([{ match: isRead, reply: ok(fixture('none')) }])
    const { client: broken } = harness([], { status: 500, contentType: null, text: '' })

    expect(await empty.checkComments(source, postId)).toEqual([])
    expect(await broken.checkComments(source, postId)).toBeNull()
  })
})

describe('execute', () => {
  it('does not post at all when the session is signed out', async () => {
    const { client, seen } = harness([{ match: isRead, reply: ok(seenBy(null)) }])

    const result = await client.execute(source, postId, '말머리를 골라 주세요')

    expect(result.error).toBe('NOT_LOGGED_IN')
    expect(seen.some(isWrite)).toBe(false)
  })

  it('counts a write as landed only when the comment reads back under our key', async () => {
    const { client, seen } = harness([
      { match: isWrite, reply: POSTED },
      { match: isRead, reply: ok(seenBy('key-operator')) },
    ])

    const result = await client.execute(source, postId, '말머리를 골라 주세요')

    expect(result.ok).toBe(true)
    expect(result.commentAuthors).toEqual(AUTHORS)
    const write = seen.find(isWrite)
    expect(write?.url).toBe('https://apis.naver.com/cafe-web/cafe-mobile/CommentPost.json')
    expect(write?.contentType).toBe('application/x-www-form-urlencoded')
    expect(write?.referer).toBe('https://cafe.naver.com/ca-fe/cafes/14538121/articles/998877')
  })

  it('reports a write that did not show up, whatever the post answered', async () => {
    // The endpoint hands back a comment id; only the re-read proves anything.
    const { client } = harness([
      { match: isWrite, reply: POSTED },
      { match: isRead, reply: ok(seenBy('key-nobody')) },
    ])

    const result = await client.execute(source, postId, '말머리를 골라 주세요')

    expect(result).toMatchObject({ ok: false, error: 'COMMENT_NOT_VISIBLE' })
  })

  it('reports a rejected post rather than claiming success', async () => {
    const { client } = harness([
      { match: isWrite, reply: { status: 403, contentType: null, text: '<html>권한이 없습니다</html>' } },
      { match: isRead, reply: ok(seenBy('key-operator')) },
    ])

    const result = await client.execute(source, postId, '말머리를 골라 주세요')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('POST_FAILED_403')
    expect(result.diagnostic).toContain('권한이 없습니다')
  })

  it('reports a thread it could not read back rather than guessing', async () => {
    let reads = 0
    const client = createArticleClient({
      http: (request) => {
        if (isWrite(request)) return Promise.resolve(POSTED)
        reads += 1
        return Promise.resolve(reads === 1 ? ok(seenBy('key-operator')) : { status: 500, contentType: null, text: '' })
      },
    })

    const result = await client.execute(source, postId, '말머리를 골라 주세요')

    expect(result).toMatchObject({ ok: false, error: 'COMMENT_CHECK_FAILED' })
  })

  it('runs the page hook immediately before posting the comment', async () => {
    const events: string[] = []
    const client = createArticleClient({
      beforeCommentPost: async () => {
        events.push('lcs_do')
      },
      http: (request) => {
        if (isWrite(request)) {
          events.push('post')
          return Promise.resolve(POSTED)
        }
        events.push('read')
        return Promise.resolve(ok(seenBy('key-operator')))
      },
    })

    await client.execute(source, postId, '말머리를 골라 주세요')

    expect(events).toEqual(['read', 'lcs_do', 'post', 'read'])
  })
})
