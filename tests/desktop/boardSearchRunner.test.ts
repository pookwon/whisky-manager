import { describe, expect, it } from 'vitest'
import { createBoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { CollectionPageError } from '../../src/desktop/collectionOrchestrator.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from '../../src/desktop/boardSearchPageFetcher.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const NO_WAIT: CollectionPacing = {
  perPage: { minSeconds: 0, maxSeconds: 0 },
  everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}

const postAt = (id: number): CollectedPostMetadata => ({
  cafeId: '14538121', postId: String(id), boardId: '137', boardName: null, title: 't', prefix: null, authorId: null, authorNickname: null,
  postedAt: Date.UTC(2025, 0, 10), viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false,
})
const page = (ids: number[], total: number): CollectedArticlePage => ({
  items: ids.map(postAt), pageInfo: { totalArticleCount: total, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: ids.join(','),
})
const EMPTY = page([], 0)

function query(q: string, order: number, lastCommittedPage: number | null = null, complete = false): BoardSearchQueryState {
  return { boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', queueOrder: order, expectedGain: 1, lastCommittedPage, insertedCount: 0, totalCount: null, complete, lastRunId: null }
}

function harness(
  queries: BoardSearchQueryState[],
  pages: Record<string, CollectedArticlePage[]>,
  fail: Record<string, string> = {},
  onRead: (query: string, page: number) => void = () => undefined,
) {
  const events: string[] = []
  const repository: BoardSearchRepository = {
    listQueries: async () => queries,
    listCollectableBoards: async () => [],
    readBoardTitles: async () => [],
    oldestPostedAtMs: async () => null,
    replaceJob: async () => undefined,
    startRun: async (input) => { events.push(`start ${input.query}`) },
    recordPageRequest: async () => undefined,
    persistPage: async (input) => { events.push(`store ${input.query} p${input.page}`); return { insertedPostCount: input.result.items.length, updatedPostCount: 0 } },
    finishRun: async (_id, status, reason) => { events.push(`finish ${status}${reason === null ? '' : ' ' + reason}`) },
  }
  const fetcher: BoardSearchPageFetcher = {
    read: async ({ query: q, page: p }) => {
      events.push(`read ${q} p${p}`)
      onRead(q, p)
      if (fail[q] !== undefined) throw new CollectionPageError(fail[q])
      return pages[q]?.[p - 1] ?? EMPTY
    },
  }
  let id = 0
  const runner = createBoardSearchRunner({
    repository: () => repository, fetcher, isConnected: () => true, clock: { now: () => 0 }, random: { intInclusive: (min: number) => min },
    pacing: () => NO_WAIT, sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => `run-${++id}`,
  })
  const settle = async () => { while (runner.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { runner, events, settle }
}

describe('boardSearchRunner', () => {
  it('walks each query to its empty page and moves on within the budget', async () => {
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1, 2], 3), page([3], 3)], 구매: [page([4], 1)] })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'started' })
    await h.settle()
    expect(h.events).toEqual([
      'start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'store 글렌 p2', 'read 글렌 p3', 'finish succeeded',
      'start 구매', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
    ])
  })

  it('stops where the budget runs out and leaves the rest for the next block', async () => {
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1], 9), page([2], 9), page([3], 9)] })
    h.runner.start({ maxPages: 2 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'store 글렌 p2', 'finish partial PAGE_BUDGET_SPENT'])
  })

  it('re-reads the last stored page when a query resumes', async () => {
    const h = harness([query('글렌', 1, 2)], { 글렌: [page([1], 3), page([2], 3), page([3], 3)] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events.slice(0, 4)).toEqual(['start 글렌', 'read 글렌 p2', 'store 글렌 p2', 'read 글렌 p3'])
  })

  it('skips finished queries, and moves on after a failure', async () => {
    const h = harness([query('끝남', 1, 5, true), query('글렌', 2), query('구매', 3)], { 구매: [page([4], 1)] }, { 글렌: 'BOARD_SEARCH_HTTP_ERROR' })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual([
      'start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_HTTP_ERROR',
      'start 구매', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
    ])
  })

  it('does not store a page that breaks the board or window guard', async () => {
    const stray = { ...page([9], 1), items: [{ ...postAt(9), boardId: '188' }] }
    const h = harness([query('글렌', 1)], { 글렌: [stray] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_WRONG_BOARD'])
  })

  it('ends the block at a stop and does not go on to the next query', async () => {
    // The stop is pressed while page 1 is being read: that page is kept, and
    // the wait before page 2 is where it lands.
    let stop = () => undefined as void
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1], 9), page([2], 9)] }, {}, (q, p) => { if (q === '글렌' && p === 1) stop() })
    stop = () => h.runner.stop()
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'finish interrupted ABORTED'])
  })

  it('does not begin a query once a stop has been asked for', async () => {
    const h = harness([query('글렌', 1)], { 글렌: [page([1], 9)] })
    h.runner.start({ maxPages: 10 })
    h.runner.stop()
    await h.settle()
    expect(h.events).toEqual([])
  })

  it('refuses a second start and a start with the extension away', async () => {
    const h = harness([query('글렌', 1)], {})
    h.runner.start({ maxPages: 10 })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
    await h.settle()
  })
})
