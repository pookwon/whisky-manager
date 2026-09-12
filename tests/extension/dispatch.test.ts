import { describe, expect, it } from 'vitest'
import { PREFIX_REMINDER_AUTOMATION_ID, WELCOME_AUTOMATION_ID } from '../../src/shared/automations/catalog.js'
import { CAFE_ARTICLE_LIST } from '../../src/shared/cafeArticleFixture.js'
import { CAFE_MEMBER_LIST } from '../../src/shared/cafeMemberFixture.js'
import type { AppMessage, ExtensionMessage, SourceRef } from '../../src/shared/protocol.js'
import { createDispatcher, type DispatcherDeps } from '../../src/extension/dispatch.js'
import type { ExecuteResult } from '../../src/extension/cafeClient.js'

const landed: ExecuteResult = { ok: true, commentAuthors: [], error: null, diagnostic: null }

function fakeCommentClient(name: string, trace: string[]) {
  return {
    checkedPosts: [] as string[],
    executed: [] as { postId: string; content: string }[],
    checkComments(_source: SourceRef, postId: string) {
      this.checkedPosts.push(postId)
      trace.push(`${name}:check`)
      return Promise.resolve([{ nickname: '회원', memberKey: 'k' }])
    },
    execute(_source: SourceRef, postId: string, content: string) {
      this.executed.push({ postId, content })
      trace.push(`${name}:execute`)
      return Promise.resolve(landed)
    },
  }
}

function setup(overrides: Partial<DispatcherDeps> = {}) {
  const trace: string[] = []
  const replies: ExtensionMessage[] = []
  const cafe = {
    ...fakeCommentClient('memo', trace),
    checkLogin: () => Promise.resolve({ loggedIn: true, account: 'ops', memberKey: 'k-ops' }),
    collect: () => Promise.resolve([]),
  }
  const articleCafe = fakeCommentClient('article', trace)
  const progress: (((pagesRead: number, collected: number) => void) | null)[] = []
  const deps: DispatcherDeps = {
    cafe,
    articleCafe,
    boardPageReader: { read: () => Promise.resolve({ ok: false as const, code: 'BOARD_PAGE_HTTP_ERROR' as const }) },
    memberPageReader: { read: () => Promise.resolve({ ok: false as const, code: 'MEMBER_PAGE_FORBIDDEN' as const }) },
    probe: (requestId, url, reply) => {
      reply({ type: 'PROBE_RESULT', requestId, status: 200, contentType: null, text: url, error: null })
      return Promise.resolve()
    },
    onHandshakeRejected: (reason) => trace.push(`rejected:${reason ?? ''}`),
    setCollectionProgress: (listener) => progress.push(listener),
    ...overrides,
  }
  const dispatch = createDispatcher(deps)
  const run = (message: AppMessage) => dispatch(message, (reply) => replies.push(reply))
  return { run, replies, trace, cafe, articleCafe, progress }
}

const action = { cafeId: '1', boardId: '2', postId: '3' }

const boardPage = (requestId: string, page: number): AppMessage => ({
  type: 'COLLECT_BOARD_PAGE',
  requestId,
  cafeId: CAFE_ARTICLE_LIST.cafeId,
  menuId: CAFE_ARTICLE_LIST.menuId,
  page,
  pageSize: CAFE_ARTICLE_LIST.pageSize,
  sortBy: CAFE_ARTICLE_LIST.sortBy,
  viewType: CAFE_ARTICLE_LIST.viewType,
})

const memberPage = (requestId: string, page: number): AppMessage => ({
  type: 'COLLECT_MEMBER_PAGE',
  requestId,
  cafeId: CAFE_MEMBER_LIST.cafeId,
  page,
  perPage: CAFE_MEMBER_LIST.perPage,
})

describe('comment routing', () => {
  it('routes CHECK_COMMENTS by automation id and refuses unknown ones', async () => {
    const { run, replies, articleCafe, cafe } = setup()

    await run({ type: 'CHECK_COMMENTS', requestId: 'r1', automationId: PREFIX_REMINDER_AUTOMATION_ID, action })
    await run({ type: 'CHECK_COMMENTS', requestId: 'r2', automationId: WELCOME_AUTOMATION_ID, action })
    await run({ type: 'CHECK_COMMENTS', requestId: 'r3', automationId: 'nope', action })

    expect(articleCafe.checkedPosts).toEqual(['3'])
    expect(cafe.checkedPosts).toEqual(['3'])
    expect(replies[0]).toMatchObject({ type: 'COMMENTS', requestId: 'r1' })
    expect(replies[2]).toMatchObject({ type: 'ERROR', requestId: 'r3', code: 'UNKNOWN_AUTOMATION' })
  })

  it('routes EXECUTE by automation id and refuses unknown ones', async () => {
    const { run, replies, articleCafe, cafe } = setup()
    const envelope = { ...action, body: '말머리를 골라 주세요' }

    await run({ type: 'EXECUTE', requestId: 'r1', automationId: PREFIX_REMINDER_AUTOMATION_ID, action: envelope })
    await run({ type: 'EXECUTE', requestId: 'r2', automationId: 'nope', action: envelope })

    expect(articleCafe.executed).toEqual([{ postId: '3', content: '말머리를 골라 주세요' }])
    expect(cafe.executed).toEqual([])
    expect(replies[0]).toMatchObject({ type: 'EXECUTED', requestId: 'r1', ok: true, strategy: 'FETCH' })
    expect(replies[1]).toMatchObject({ type: 'ERROR', requestId: 'r2', code: 'UNKNOWN_AUTOMATION' })
  })

  it('names the automation it could not answer for, and nothing else', async () => {
    const { run, replies } = setup()

    await run({ type: 'CHECK_COMMENTS', requestId: 'r1', automationId: 'nope', action })

    expect(replies[0]).toMatchObject({ message: 'nope' })
  })
})

describe('the rest of the instructions', () => {
  it('answers a login check with the account the session belongs to', async () => {
    const { run, replies } = setup()

    await run({ type: 'CHECK_LOGIN', requestId: 'r1', source: { cafeId: '1', boardId: '2' } })

    expect(replies[0]).toEqual({ type: 'LOGIN_STATE', requestId: 'r1', loggedIn: true, account: 'ops' })
  })

  it('reports collection progress while collecting and stops reporting afterwards', async () => {
    const { run, replies, progress } = setup()

    await run({
      type: 'COLLECT',
      requestId: 'r1',
      automationId: WELCOME_AUTOMATION_ID,
      source: { cafeId: '1', boardId: '2' },
      sincePostedAt: 0,
    })

    expect(replies[0]).toMatchObject({ type: 'COLLECTED', requestId: 'r1', candidates: [] })
    // A listener is installed for the run and taken away when it ends: a reply
    // sent after the request is over has nobody waiting for it.
    expect(progress.length).toBe(2)
    expect(progress[0]).toBeTypeOf('function')
    expect(progress[1]).toBeNull()
  })

  it('forwards progress to the reply channel while the run is underway', async () => {
    const { run, replies, progress } = setup({
      cafe: {
        ...fakeCommentClient('memo', []),
        checkLogin: () => Promise.resolve({ loggedIn: true, account: 'ops', memberKey: 'k' }),
        collect: () => Promise.resolve([]),
      },
    })

    await run({
      type: 'COLLECT',
      requestId: 'r1',
      automationId: WELCOME_AUTOMATION_ID,
      source: { cafeId: '1', boardId: '2' },
      sincePostedAt: 0,
    })
    progress[0]?.(2, 7)

    expect(replies.at(-1)).toEqual({ type: 'COLLECT_PROGRESS', requestId: 'r1', pagesRead: 2, collected: 7 })
  })

  it('reports a page read failure as a body-free code', async () => {
    const { run, replies } = setup()

    await run(boardPage('r1', 1))
    await run(memberPage('r2', 1))

    expect(replies[0]).toMatchObject({ type: 'ERROR', code: 'BOARD_PAGE_HTTP_ERROR', message: 'BOARD_PAGE_HTTP_ERROR' })
    expect(replies[1]).toMatchObject({ type: 'ERROR', code: 'MEMBER_PAGE_FORBIDDEN' })
  })

  it('passes a read page straight through', async () => {
    const page = { items: [], pageIdentity: 'x', totalCount: null }
    const { run, replies } = setup({
      boardPageReader: { read: () => Promise.resolve({ ok: true as const, page: 3, result: page as never }) },
      memberPageReader: { read: () => Promise.resolve({ ok: true as const, page: 4, result: page as never }) },
    })

    await run(boardPage('r1', 3))
    await run(memberPage('r2', 4))

    expect(replies[0]).toMatchObject({ type: 'BOARD_PAGE_COLLECTED', page: 3 })
    expect(replies[1]).toMatchObject({ type: 'MEMBER_PAGE_COLLECTED', page: 4 })
  })

  it('hands a probe to the probe itself and ignores an abort', async () => {
    const { run, replies } = setup()

    await run({ type: 'PROBE', requestId: 'r1', url: 'https://cafe.naver.com/' })
    await run({ type: 'ABORT', requestId: 'r2' })

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ type: 'PROBE_RESULT', text: 'https://cafe.naver.com/' })
  })

  it('tells the assembly when the bridge refused the handshake, and stays quiet when it did not', async () => {
    const { run, trace, replies } = setup()

    await run({ type: 'HELLO_ACK', accepted: false, reason: 'version' })
    await run({ type: 'HELLO_ACK', accepted: true, reason: null })

    expect(trace).toEqual(['rejected:version'])
    expect(replies).toHaveLength(0)
  })
})
