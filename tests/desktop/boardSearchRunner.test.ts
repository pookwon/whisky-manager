import { describe, expect, it } from 'vitest'
import { createBoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
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
/** One post from another board: the query's own results are wrong, not the request. */
const STRAY = { ...page([9], 1), items: [{ ...postAt(9), boardId: '188' }] }

function query(q: string, order: number, lastCommittedPage: number | null = null, complete = false): BoardSearchQueryState {
  return { boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', queueOrder: order, expectedGain: 1, lastCommittedPage, insertedCount: 0, totalCount: null, complete, lastRunId: null }
}

function harness(
  queries: BoardSearchQueryState[],
  pages: Record<string, CollectedArticlePage[]>,
  fail: Record<string, string> = {},
  onRead: (query: string, page: number) => void = () => undefined,
  setup: { readonly storage?: boolean; readonly connected?: boolean; readonly failedFinishRejectsFor?: string } = {},
) {
  const events: string[] = []
  const windows: string[] = []
  const queryOfRun = new Map<string, string>()
  const repository: BoardSearchRepository = {
    listQueries: async () => queries,
    listCollectableBoards: async () => [],
    readBoardTitles: async () => [],
    oldestPostedAtMs: async () => null,
    replaceJob: async () => undefined,
    startRun: async (input) => { queryOfRun.set(input.id, input.query); events.push(`start ${input.query}`) },
    recordPageRequest: async () => undefined,
    persistPage: async (input) => { events.push(`store ${input.query} p${input.page}`); windows.push(`${input.fromDay}-${input.toDay}`); return { insertedPostCount: input.result.items.length, updatedPostCount: 0 } },
    finishRun: async (id, status, reason) => {
      events.push(`finish ${status}${reason === null ? '' : ' ' + reason}`)
      if (status === 'failed' && queryOfRun.get(id) === setup.failedFinishRejectsFor) throw new Error('database went away')
    },
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
    repository: () => (setup.storage === false ? null : repository), fetcher, isConnected: () => setup.connected !== false, clock: { now: () => 0 }, random: { intInclusive: (min: number) => min },
    pacing: () => NO_WAIT, sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => `run-${++id}`,
  })
  const settle = async () => { while (runner.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { runner, events, windows, settle }
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

  it('writes each page against the window of the query it walks', async () => {
    const h = harness([query('글렌', 1)], { 글렌: [page([1], 2), page([2], 2)] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.windows).toEqual(['20250101-20250829', '20250101-20250829'])
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

  it('skips finished queries, and ends the block at a failure every query would share', async () => {
    const h = harness([query('끝남', 1, 5, true), query('글렌', 2), query('구매', 3)], { 구매: [page([4], 1)] }, { 글렌: 'BOARD_SEARCH_HTTP_ERROR' })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_HTTP_ERROR'])
  })

  it('moves on to the next query after a failure of the query\'s own results', async () => {
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [STRAY], 구매: [page([4], 1)] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual([
      'start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_WRONG_BOARD: 9 on 188',
      'start 구매', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
    ])
  })

  it('does not store a page that breaks the board or window guard', async () => {
    const h = harness([query('글렌', 1)], { 글렌: [STRAY] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_WRONG_BOARD: 9 on 188'])
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

  it('refuses a second start, a start without storage and a start with the extension away', async () => {
    const h = harness([query('글렌', 1)], {})
    h.runner.start({ maxPages: 10 })
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
    await h.settle()
    expect(harness([query('글렌', 1)], {}, {}, undefined, { storage: false }).runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
    expect(harness([query('글렌', 1)], {}, {}, undefined, { connected: false }).runner.start({ maxPages: 10 })).toEqual({ kind: 'refused', reason: 'BRIDGE_OFFLINE' })
  })

  it('goes on to the next query when a failed run cannot be written, and frees the lock after', async () => {
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [STRAY], 구매: [page([4], 1)] }, {}, undefined, { failedFinishRejectsFor: '글렌' })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual([
      'start 글렌', 'read 글렌 p1', 'finish failed BOARD_SEARCH_WRONG_BOARD: 9 on 188',
      'start 구매', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
    ])
    expect(h.runner.start({ maxPages: 10 })).toEqual({ kind: 'started' })
    await h.settle()
  })
})
