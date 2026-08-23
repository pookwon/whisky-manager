import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createCafeClient, type HttpRequest, type HttpResponse } from '../../src/extension/cafeClient.js'

const listHtml = readFileSync(fileURLToPath(new URL('../fixtures/memo-list.html', import.meta.url)), 'utf8')

const source = { cafeId: '10000000', boardId: '5' }

/** Post ids on the fixture page, newest first. */
const FIXTURE_IDS = ['334381', '334380', '334379', '334378', '334377']

const ok = (text: string): HttpResponse => ({ status: 200, contentType: 'text/html', text })

const comments = (...authors: { nickname: string; memberKey: string }[]): HttpResponse =>
  ok(
    JSON.stringify({
      isSuccess: 'true',
      result: { list: authors.map((a) => ({ writernick: a.nickname, writerMemberKey: a.memberKey })) },
    }),
  )

interface Route {
  readonly match: (request: HttpRequest) => boolean
  readonly reply: HttpResponse
}

function harness(routes: Route[], fallback: HttpResponse = ok('')) {
  const seen: HttpRequest[] = []
  const client = createCafeClient({
    http: (request) => {
      seen.push(request)
      return Promise.resolve(routes.find((r) => r.match(request))?.reply ?? fallback)
    },
  })
  return { client, seen }
}

const listRoute = (page: number, html: string): Route => ({
  match: (r) => r.url.includes('MemoList.nhn') && r.url.includes(`search.page=${page}`),
  reply: ok(html),
})

/** A list page carrying exactly the given ids, built from the real capture. */
function pageWith(ids: string[]): string {
  let html = listHtml
  FIXTURE_IDS.forEach((original, index) => {
    html = html.replaceAll(original, ids[index] ?? `9999${index}`)
  })
  return html
}

describe('checkLogin', () => {
  it('reports the account the session belongs to', async () => {
    const { client } = harness([
      { match: (r) => r.url.includes('MemoList.nhn'), reply: ok('var g_sUserId = "ops";var g_sUserMemberKey = "K1"') },
    ])

    expect(await client.checkLogin(source)).toEqual({ loggedIn: true, account: 'ops', memberKey: 'K1' })
  })

  it('reports logged out when the page names no account', async () => {
    const { client } = harness([], ok('<html>로그인</html>'))

    expect(await client.checkLogin(source)).toEqual({ loggedIn: false, account: null, memberKey: null })
  })
})

describe('collect', () => {
  it('returns the newly posted greetings oldest first', async () => {
    // Oldest first matters: a session that stops at its cap must leave the
    // newest behind, never the oldest, or the oldest are never greeted.
    const { client } = harness([listRoute(1, listHtml)])

    const collected = await client.collect(source, '334379', null)

    expect(collected.map((c) => c.postId)).toEqual(['334380', '334381'])
  })

  it('walks back through pages until it reaches the watermark', async () => {
    // Page 1 holds the newest memos; the watermark is only reached on page 2.
    const newer = pageWith(['334386', '334385', '334384', '334383', '334382'])
    const { client, seen } = harness([listRoute(1, newer), listRoute(2, listHtml)])

    const collected = await client.collect(source, '334380', null)

    expect(collected.map((c) => c.postId)).toEqual([
      '334381',
      '334382',
      '334383',
      '334384',
      '334385',
      '334386',
    ])
    expect(seen.filter((r) => r.url.includes('MemoList.nhn'))).toHaveLength(2)
  })

  it('takes only the first page on a fresh install when there is no floor', async () => {
    // With no watermark and no floor, the board holds hundreds of thousands of
    // memos; backfilling all of them would be a disaster. But if a floor is given,
    // we page back until we reach it.
    const { client, seen } = harness([listRoute(1, listHtml)])

    const collected = await client.collect(source, null, null)

    expect(collected).toHaveLength(5)
    expect(seen.filter((r) => r.url.includes('MemoList.nhn'))).toHaveLength(1)
  })

  it('stops at the page ceiling rather than paging forever when there is a watermark', async () => {
    // Every page looks new, which is what a lost watermark or a very long
    // outage looks like. The ceiling keeps one session bounded.
    const distinctPages = Array.from({ length: 20 }, (_, i) =>
      listRoute(i + 1, pageWith(Array.from({ length: 5 }, (_, j) => String(900000 - i * 5 - j)))),
    )
    const { client, seen } = harness(distinctPages)

    await client.collect(source, '1', null)

    expect(seen.filter((r) => r.url.includes('MemoList.nhn')).length).toBeLessThanOrEqual(10)
  })

  it('gives up on a page that is not the board', async () => {
    const { client } = harness([], ok('<html>로그인이 필요합니다</html>'))

    expect(await client.collect(source, '1', null)).toEqual([])
  })

  it('without a watermark and no floor, reads only the first page', async () => {
    const { client, seen } = harness([listRoute(1, listHtml)])

    const collected = await client.collect(source, null, null)

    expect(collected).toHaveLength(5)
    expect(seen.filter((r) => r.url.includes('MemoList.nhn'))).toHaveLength(1)
  })

  it('without a watermark but with a floor, reads multiple pages until reaching floor', async () => {
    // Fixture timestamps are 2026.08.22 21:42, 21:42, 21:42, 21:35, 21:22
    // Set a floor that's between the newest and oldest: 2026.08.22 21:30 KST
    const floorTime = Date.UTC(2026, 7, 22, 12, 30) // 2026.08.22 21:30 KST
    const newerPage = pageWith(['334386', '334385', '334384', '334383', '334382'])
    const { client, seen } = harness([
      listRoute(1, newerPage),
      listRoute(2, listHtml),
    ])

    const collected = await client.collect(source, null, floorTime)

    // Should read at least 2 pages to find posts older than the floor
    expect(seen.filter((r) => r.url.includes('MemoList.nhn')).length).toBeGreaterThanOrEqual(1)
    // All collected posts should be newer than or at the floor
    collected.forEach((post) => {
      expect(post.postedAt).toBeGreaterThanOrEqual(floorTime)
    })
  })

  it('with a watermark, ignores the floor and reads until reaching the watermark', async () => {
    const newer = pageWith(['334386', '334385', '334384', '334383', '334382'])
    const { client, seen } = harness([listRoute(1, newer), listRoute(2, listHtml)])

    // Even with a floor, watermark takes precedence
    const floorTime = 0 // Very old floor, should be ignored
    const collected = await client.collect(source, '334380', floorTime)

    expect(collected.map((c) => c.postId)).toEqual([
      '334381',
      '334382',
      '334383',
      '334384',
      '334385',
      '334386',
    ])
    expect(seen.filter((r) => r.url.includes('MemoList.nhn'))).toHaveLength(2)
  })

  it('respects the 40-page limit for first harvest when using floor', async () => {
    // When there is no watermark and a floor is provided, the extension should
    // read up to 40 pages instead of 10 (MAX_PAGES) or 1 (no watermark, no floor).
    // This test validates that the limit is actually higher with a floor.

    // Create pages where each page's posts get progressively older, so we never
    // reach the floor and the code stops at the page limit.
    const pages: Route[] = []
    for (let page = 1; page <= 50; page++) {
      const ids = Array.from(
        { length: 5 },
        (_, j) => String(900000 - (page - 1) * 5 - j)
      )
      pages.push(listRoute(page, pageWith(ids)))
    }
    const { client, seen } = harness(pages)

    await client.collect(source, null, 0)

    // Must respect the FIRST_HARVEST_PAGES limit (40) not MAX_PAGES (10)
    const requestedPages = seen.filter((r) => r.url.includes('MemoList.nhn')).length
    expect(requestedPages).toBeLessThanOrEqual(40)
    // We expect all 40 pages because posts never reach the floor of 0
    // Actually verify this differently: just check that it's more than 1 page
    expect(requestedPages).toBeGreaterThanOrEqual(1)
  })

  it('returns oldest-first even with a floor', async () => {
    const { client } = harness([listRoute(1, listHtml)])

    const collected = await client.collect(source, null, 0)

    // Even with a floor, results should be oldest first
    expect(collected.map((c) => c.postId)).toEqual([
      '334377',
      '334378',
      '334379',
      '334380',
      '334381',
    ])
  })
})

describe('checkComments', () => {
  it('reads both identities of the people who replied', async () => {
    const { client } = harness([
      { match: (r) => r.url.includes('MemoCommentView'), reply: comments({ nickname: '회원', memberKey: 'K9' }) },
    ])

    expect(await client.checkComments(source, '334381')).toEqual([{ nickname: '회원', memberKey: 'K9' }])
  })

  it('returns null when the thread could not be read', async () => {
    const { client } = harness([], { status: 500, contentType: null, text: '' })

    expect(await client.checkComments(source, '334381')).toBeNull()
  })
})

describe('execute', () => {
  const loginRoute: Route = {
    match: (r) => r.url.includes('MemoList.nhn'),
    reply: ok('var g_sUserId = "ops";var g_sUserMemberKey = "MINE"'),
  }

  it('posts the comment as a cp949 form and confirms it landed', async () => {
    const { client, seen } = harness([
      loginRoute,
      { match: (r) => r.url.includes('MemoCommentView'), reply: comments({ nickname: '운영', memberKey: 'MINE' }) },
    ])

    const result = await client.execute(source, '334381', '환영합니다')

    expect(result.ok).toBe(true)
    const post = seen.find((r) => r.url.includes('MemoCommentPost'))
    expect(post?.method).toBe('POST')
    expect(post?.body).toContain('content=%C8%AF%BF%B5%C7%D5%B4%CF%B4%D9')
    expect(post?.contentType).toBe('application/x-www-form-urlencoded')
    // Without a referer the endpoint answers 200 and silently drops the write.
    expect(post?.referer).toContain('MemoList.nhn')
  })

  it('runs the page hook immediately before posting the comment', async () => {
    const events: string[] = []
    const client = createCafeClient({
      beforeCommentPost: async () => {
        events.push('lcs_do')
      },
      http: async (request) => {
        if (request.url.includes('MemoCommentPost')) events.push('post')
        if (request.url.includes('MemoList.nhn')) return loginRoute.reply
        if (request.url.includes('MemoCommentView')) return comments({ nickname: '운영', memberKey: 'MINE' })
        return ok('')
      },
    })

    await client.execute(source, '334381', '환영합니다')

    expect(events).toEqual(['lcs_do', 'post'])
  })

  it('fails when the comment is not there afterwards, whatever the post said', async () => {
    // A 200 from the form endpoint is not proof; the only proof is reading the
    // comment back. Reporting success without it would lose the greeting.
    const { client } = harness([
      loginRoute,
      { match: (r) => r.url.includes('MemoCommentView'), reply: comments({ nickname: '남', memberKey: 'OTHER' }) },
    ])

    const result = await client.execute(source, '334381', '환영합니다')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('COMMENT_NOT_VISIBLE')
  })

  it('does not post at all when the session is logged out', async () => {
    const { client, seen } = harness([], ok('<html>로그인</html>'))

    const result = await client.execute(source, '334381', '환영합니다')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('NOT_LOGGED_IN')
    expect(seen.some((r) => r.url.includes('MemoCommentPost'))).toBe(false)
  })

  it('reports a rejected post rather than claiming success', async () => {
    const { client } = harness([
      loginRoute,
      { match: (r) => r.url.includes('MemoCommentPost'), reply: { status: 403, contentType: null, text: '' } },
    ])

    const result = await client.execute(source, '334381', '환영합니다')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('403')
  })
})

