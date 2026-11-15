import { describe, expect, it } from 'vitest'
import {
  ATTENDANCE_BOARD_MENU_ID,
  createAttendanceCollection,
  type AttendanceCollectionDeps,
} from '../../src/desktop/attendanceCollection.js'
import type { BoardPageFetcher } from '../../src/desktop/collectionOrchestrator.js'
import type { ArticleBodyFetcher } from '../../src/desktop/articleBodyFetcher.js'
import { createCollectionLock, type CollectionLock } from '../../src/desktop/collectionLock.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { AttendanceRepository } from '../../src/desktop/collection-db/attendanceRepository.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import type { CafeArticleBodyRead } from '../../src/shared/cafeArticleBody.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const NO_WAIT: CollectionPacing = {
  perPage: { minSeconds: 0, maxSeconds: 0 },
  everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}
/** One second a page, so each request's ordinal shows in the gap before it. */
const PACED: CollectionPacing = {
  perPage: { minSeconds: 1, maxSeconds: 1 },
  everyTwentyPages: { minSeconds: 2, maxSeconds: 2 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}

const NOW = Date.UTC(2026, 10, 16)
/** A KST wall-clock instant as epoch ms (KST is UTC+9). */
const kst = (year: number, month: number, day: number, hour = 12): number =>
  Date.UTC(year, month - 1, day, hour - 9)

function item(postId: string, title: string | null, postedAt: number): CollectedPostMetadata {
  return {
    cafeId: '14538121', postId, boardId: '207', boardName: null, title, prefix: null,
    authorId: null, authorNickname: null, postedAt, viewCount: null, commentCount: null,
    replyCount: null, isNotice: false,
  }
}
function page(items: readonly CollectedPostMetadata[]): CollectedArticlePage {
  return { items, pageInfo: { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: null }, pageIdentity: items.map((i) => i.postId).join(',') }
}
const EMPTY = page([])

function winnersBody(postId: string, nicknames: readonly string[]): CafeArticleBodyRead {
  return { kind: 'article', postId, title: 't', postedAt: NOW, contentHtml: `<div>${nicknames.join('님, ')}님이 당첨 되셨습니다</div>` }
}
const noPhraseBody = (postId: string): CafeArticleBodyRead => ({ kind: 'article', postId, title: 't', postedAt: NOW, contentHtml: '<div>아직 집계 전입니다</div>' })
const absentBody: CafeArticleBodyRead = { kind: 'absent', status: 404, code: '4003' }

/** Three attendance posts across two pages, then an empty page. */
const COMMENT = item('963461', '[댓글 개근] 11월 1일 ~ 11월 7일', kst(2026, 11, 8))
const POST = item('963460', '[게시글 개근] 11월 1일 ~ 11월 7일', kst(2026, 11, 8))
const POPULAR = item('962584', '이달의 인기멤버 안내', kst(2026, 11, 8))
const VISIT_2021 = item('148887', '[방문 개근] 11월 1일 ~ 11월 7일', kst(2021, 11, 8))

interface Config {
  readonly pages: readonly CollectedArticlePage[]
  readonly bodies?: Record<string, CafeArticleBodyRead | string>
  readonly pacing?: CollectionPacing
  readonly connected?: boolean
  readonly noRepository?: boolean
  readonly lock?: CollectionLock
  readonly onListRead?: (p: number) => void
  readonly onBodyRead?: (postId: string) => void
}

type Saved =
  | { readonly status: 'recorded'; readonly nicknames: readonly string[] }
  | { readonly status: 'refused'; readonly rule: string }

function harness(config: Config) {
  const saved = new Map<string, Saved>()
  const saves: string[] = []
  const repository: AttendanceRepository = {
    recordedPostIds: async () => new Set([...saved].filter(([, v]) => v.status === 'recorded').map(([id]) => id)),
    saveRecorded: async (post, nicknames) => {
      saves.push(`recorded ${post.postId} [${nicknames.join(',')}]`)
      saved.set(post.postId, { status: 'recorded', nicknames })
    },
    saveRefused: async (post, rule) => {
      saves.push(`refused ${post.postId} ${rule}`)
      saved.set(post.postId, { status: 'refused', rule })
    },
  }
  const listReads: number[] = []
  const listFetcher: BoardPageFetcher = {
    read: async (p) => { listReads.push(p); config.onListRead?.(p); return config.pages[p - 1] ?? EMPTY },
  }
  const bodyReads: string[] = []
  const bodyFetcher: ArticleBodyFetcher = {
    read: async (postId) => {
      bodyReads.push(postId)
      config.onBodyRead?.(postId)
      const answer = config.bodies?.[postId]
      if (typeof answer === 'string') throw new CollectionPageError(answer, `id ${postId}`)
      if (answer === undefined) throw new Error(`no body for ${postId}`)
      return answer
    },
  }
  const sleeps: number[] = []
  const errors: string[] = []
  const lock = config.lock ?? createCollectionLock()
  const deps: AttendanceCollectionDeps = {
    repository: () => (config.noRepository === true ? null : repository),
    listFetcher,
    bodyFetcher,
    isConnected: () => config.connected !== false,
    lock,
    pacing: () => config.pacing ?? NO_WAIT,
    random: { intInclusive: (min) => min },
    sleep: async (ms) => { sleeps.push(ms) },
    now: () => NOW,
    onError: (error) => { errors.push(error instanceof Error ? error.message : String(error)) },
  }
  return { collection: createAttendanceCollection(deps), saved, saves, listReads, bodyReads, sleeps, errors, lock }
}

describe('attendanceCollection', () => {
  it('is bound to the member-of-the-month board', () => {
    expect(ATTENDANCE_BOARD_MENU_ID).toBe('207')
  })

  it('stores every attendance post of the board and nothing else', async () => {
    const h = harness({
      pages: [page([COMMENT, POST, POPULAR]), page([VISIT_2021]), EMPTY],
      bodies: {
        963461: winnersBody('963461', ['가가', '나나']),
        963460: winnersBody('963460', ['다다']),
        148887: winnersBody('148887', ['라라', '마마']),
      },
    })
    h.collection.start()
    await h.collection.settled()
    expect(h.bodyReads).toEqual(['963461', '963460', '148887'])
    expect(h.saves).toEqual([
      'recorded 963461 [가가,나나]',
      'recorded 963460 [다다]',
      'recorded 148887 [라라,마마]',
    ])
    expect(h.collection.progress()).toEqual({ state: 'done', listPage: 3, postsTotal: 3, postsRead: 3, failureCode: null })
  })

  it('reads no body on a second run', async () => {
    const h = harness({
      pages: [page([COMMENT, POST]), EMPTY],
      bodies: { 963461: winnersBody('963461', ['가가']), 963460: winnersBody('963460', ['나나']) },
    })
    h.collection.start()
    await h.collection.settled()
    h.collection.start()
    await h.collection.settled()
    expect(h.bodyReads).toEqual(['963461', '963460'])
    expect(h.saved.size).toBe(2)
    expect(h.collection.progress()).toMatchObject({ state: 'done', postsTotal: 0, postsRead: 0 })
  })

  it('reads a refused post again on the next run', async () => {
    const bodies: Record<string, CafeArticleBodyRead> = { 963461: noPhraseBody('963461') }
    const h = harness({ pages: [page([COMMENT]), EMPTY], bodies })
    h.collection.start()
    await h.collection.settled()
    expect(h.saves).toEqual(['refused 963461 NO_CLOSING_PHRASE'])
    bodies[963461] = winnersBody('963461', ['가가'])
    h.collection.start()
    await h.collection.settled()
    expect(h.bodyReads).toEqual(['963461', '963461'])
    expect(h.saves).toEqual(['refused 963461 NO_CLOSING_PHRASE', 'recorded 963461 [가가]'])
  })

  it('ends the walk when the list starts repeating', async () => {
    const first = page([COMMENT, POST])
    const h = harness({
      pages: [first, page([VISIT_2021]), first],
      bodies: {
        963461: winnersBody('963461', ['가가']),
        963460: winnersBody('963460', ['나나']),
        148887: winnersBody('148887', ['다다']),
      },
    })
    h.collection.start()
    await h.collection.settled()
    expect(h.listReads).toEqual([1, 2, 3])
    expect(h.collection.progress()).toMatchObject({ state: 'done', listPage: 3 })
  })

  it('refuses an unreadable period without reading the body', async () => {
    const noPeriod = item('963461', '[댓글 개근] 이번 회차 안내', kst(2026, 11, 8))
    const h = harness({ pages: [page([noPeriod, POST]), EMPTY], bodies: { 963460: winnersBody('963460', ['가가']) } })
    h.collection.start()
    await h.collection.settled()
    expect(h.bodyReads).toEqual(['963460'])
    expect(h.saves).toEqual(['refused 963461 PERIOD_UNREADABLE', 'recorded 963460 [가가]'])
  })

  it('refuses a post that is gone and goes on', async () => {
    const h = harness({
      pages: [page([COMMENT, POST]), EMPTY],
      bodies: { 963461: absentBody, 963460: winnersBody('963460', ['가가']) },
    })
    h.collection.start()
    await h.collection.settled()
    expect(h.saves).toEqual(['refused 963461 ARTICLE_ABSENT', 'recorded 963460 [가가]'])
  })

  it('fails, keeps what it stored and frees the lock when the extension drops', async () => {
    const h = harness({
      pages: [page([COMMENT, POST]), EMPTY],
      bodies: { 963461: winnersBody('963461', ['가가']), 963460: 'EXTENSION_OFFLINE' },
    })
    h.collection.start()
    await h.collection.settled()
    expect(h.collection.progress()).toMatchObject({ state: 'failed', failureCode: 'EXTENSION_OFFLINE', postsRead: 1 })
    expect(h.saves).toEqual(['recorded 963461 [가가]'])
    expect(h.lock.isHeld()).toBe(false)
    expect(h.errors).toEqual(['EXTENSION_OFFLINE: id 963460'])
  })

  it('stops between requests', async () => {
    let stop = (): void => undefined
    const h = harness({
      pages: [page([COMMENT, POST]), EMPTY],
      bodies: { 963461: winnersBody('963461', ['가가']), 963460: winnersBody('963460', ['나나']) },
      onBodyRead: (postId) => { if (postId === '963461') stop() },
    })
    stop = () => h.collection.stop()
    h.collection.start()
    await h.collection.settled()
    expect(h.collection.progress()).toMatchObject({ state: 'stopped', postsRead: 1 })
    expect(h.saves).toEqual(['recorded 963461 [가가]'])
    expect(h.lock.isHeld()).toBe(false)
  })

  it('says why it did not start', async () => {
    const running = harness({ pages: [page([COMMENT]), EMPTY], bodies: { 963461: winnersBody('963461', ['가가']) } })
    expect(running.collection.start()).toBe('STARTED')
    expect(running.collection.start()).toBe('ALREADY_RUNNING')
    await running.collection.settled()

    const noDb = harness({ pages: [EMPTY], noRepository: true })
    expect(noDb.collection.start()).toBe('DATABASE_DISABLED')
    expect(noDb.lock.isHeld()).toBe(false)

    const offline = harness({ pages: [EMPTY], connected: false })
    expect(offline.collection.start()).toBe('EXTENSION_OFFLINE')
    expect(offline.lock.isHeld()).toBe(false)

    const busyLock = createCollectionLock()
    busyLock.tryAcquire()
    const busy = harness({ pages: [EMPTY], lock: busyLock })
    expect(busy.collection.start()).toBe('COLLECTION_BUSY')
    expect(busyLock.isHeld()).toBe(true)
  })

  it('waits the paced gap before every request but the first', async () => {
    const h = harness({
      pages: [page([COMMENT, POST, POPULAR]), page([VISIT_2021]), EMPTY],
      bodies: {
        963461: winnersBody('963461', ['가가']),
        963460: winnersBody('963460', ['나나']),
        148887: winnersBody('148887', ['다다']),
      },
      pacing: PACED,
    })
    h.collection.start()
    await h.collection.settled()
    // 3 list reads + 3 body reads = 6 requests; the first waits nothing.
    expect(h.sleeps).toEqual([1_000, 1_000, 1_000, 1_000, 1_000])
  })
})
