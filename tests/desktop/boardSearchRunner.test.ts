import { describe, expect, it } from 'vitest'
import { createBoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { BoardSearchPageFetcher } from '../../src/desktop/boardSearchPageFetcher.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import { BOARD_SEARCH_CAP_PAGE, CAFE_BOARD_SEARCH } from '../../src/shared/cafeBoardSearchEndpoint.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const NO_WAIT: CollectionPacing = {
  perPage: { minSeconds: 0, maxSeconds: 0 },
  everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}

/** Noon KST of a January 2025 day. */
const januaryNoon = (day: number) => Date.UTC(2025, 0, day, 3)
const postAt = (id: number, postedAt = januaryNoon(3)): CollectedPostMetadata => ({
  cafeId: '14538121', postId: String(id), boardId: '137', boardName: null, title: 't', prefix: null, authorId: null, authorNickname: null,
  postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false,
})
const page = (ids: number[], total: number): CollectedArticlePage => ({
  items: ids.map((id) => postAt(id)), pageInfo: { totalArticleCount: total, lastNavigationPageNumber: 1, visibleNextButton: false }, pageIdentity: ids.join(','),
})
const EMPTY = page([], 0)
/**
 * Pages 1 to the cap, each holding `perPage` posts from `newestDay`, except
 * that the last post of the cap page — the results come newest first — is from
 * `oldestDay`.
 */
function pagesToTheCap(oldestDay: number, newestDay = 20): CollectedArticlePage[] {
  return Array.from({ length: BOARD_SEARCH_CAP_PAGE }, (_, index) => {
    const ids = Array.from({ length: CAFE_BOARD_SEARCH.perPage }, (_, item) => 1_000_000 - index * CAFE_BOARD_SEARCH.perPage - item)
    const items = ids.map((id, item) => postAt(id, index === BOARD_SEARCH_CAP_PAGE - 1 && item === CAFE_BOARD_SEARCH.perPage - 1 ? januaryNoon(oldestDay) : januaryNoon(newestDay)))
    return { items, pageInfo: { totalArticleCount: 2000, lastNavigationPageNumber: 10, visibleNextButton: true }, pageIdentity: `cap-${index}` }
  })
}
/** A page of `perPage` posts from `newestDay` whose last post is from `oldestDay`. */
function fullPage(firstId: number, oldestDay: number, newestDay = 20): CollectedArticlePage {
  const items = Array.from({ length: CAFE_BOARD_SEARCH.perPage }, (_, item) =>
    postAt(firstId - item, item === CAFE_BOARD_SEARCH.perPage - 1 ? januaryNoon(oldestDay) : januaryNoon(newestDay)))
  return { items, pageInfo: { totalArticleCount: 2000, lastNavigationPageNumber: 10, visibleNextButton: true }, pageIdentity: `full-${firstId}` }
}
/** The empty page the search serves once it stops serving a window: its pageInfo is all zeros. */
const ZEROS: CollectedArticlePage = { items: [], pageInfo: { totalArticleCount: 0, lastNavigationPageNumber: 0, visibleNextButton: false }, pageIdentity: '' }
/** One post from another board: the query's own results are wrong, not the request. */
const STRAY = { ...page([9], 1), items: [{ ...postAt(9), boardId: '188' }] }

function query(q: string, order: number, lastCommittedPage: number | null = null, complete = false, segmentToDay: string | null = null): BoardSearchQueryState {
  return { boardId: '137', query: q, fromDay: '20250101', toDay: '20250829', segmentToDay, queueOrder: order, expectedGain: 1, lastCommittedPage, insertedCount: 0, totalCount: null, complete, lastRunId: null }
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
  /** Every request as `query fromDay-toDay pN`. */
  const requests: string[] = []
  const queryOfRun = new Map<string, string>()
  const repository: BoardSearchRepository = {
    listQueries: async () => queries,
    listCollectableBoards: async () => [],
    readBoardTitles: async () => [],
    oldestPostedAtMs: async () => null,
    replaceJob: async () => undefined,
    startRun: async (input) => { queryOfRun.set(input.id, input.query); events.push(`start ${input.query}`) },
    recordPageRequest: async () => undefined,
    narrowSegment: async (input) => { events.push(`narrow ${input.query} ${input.fromDay}-${input.toDay} to ${input.segmentToDay}`) },
    persistPage: async (input) => { events.push(`store ${input.query} p${input.page}`); windows.push(`${input.fromDay}-${input.toDay}`); return { insertedPostCount: input.result.items.length, updatedPostCount: 0 } },
    finishRun: async (id, status, reason) => {
      events.push(`finish ${status}${reason === null ? '' : ' ' + reason}`)
      if (status === 'failed' && queryOfRun.get(id) === setup.failedFinishRejectsFor) throw new Error('database went away')
    },
  }
  const fetcher: BoardSearchPageFetcher = {
    // A query's pages are keyed by the query, or by `query@toDay` for a narrower window.
    read: async ({ query: q, fromDay, toDay, page: p }) => {
      events.push(`read ${q} p${p}`)
      requests.push(`${q} ${fromDay}-${toDay} p${p}`)
      onRead(q, p)
      if (fail[q] !== undefined) throw new CollectionPageError(fail[q])
      return (pages[`${q}@${toDay}`] ?? (toDay === '20250829' ? pages[q] : undefined))?.[p - 1] ?? EMPTY
    },
  }
  let id = 0
  const runner = createBoardSearchRunner({
    repository: () => (setup.storage === false ? null : repository), fetcher, isConnected: () => setup.connected !== false, clock: { now: () => 0 }, random: { intInclusive: (min: number) => min },
    pacing: () => NO_WAIT, sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => `run-${++id}`,
  })
  const settle = async () => { while (runner.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { runner, events, windows, requests, settle }
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

  it('ends the block, storing nothing, when a page is newer than the page before it', async () => {
    const newer = { ...page([2], 9), items: [postAt(2, januaryNoon(5))] }
    const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page([1], 9), newer], 구매: [page([4], 1)] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'finish failed BOARD_SEARCH_OUT_OF_ORDER: 2'])
  })

  it('accepts a page whose newest post is as old as the oldest post of the page before it', async () => {
    const first = { ...page([3, 2], 3), items: [postAt(3, januaryNoon(5)), postAt(2, januaryNoon(3))] }
    const h = harness([query('글렌', 1)], { 글렌: [first, page([1], 3)] })
    h.runner.start({ maxPages: 10 })
    await h.settle()
    expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'store 글렌 p2', 'read 글렌 p3', 'finish succeeded'])
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

  describe('at the search\'s result cap', () => {
    const CAP = BOARD_SEARCH_CAP_PAGE

    it('narrows to the oldest day of a full cap page and walks on from page 1 in the same run', async () => {
      const h = harness([query('구매', 1)], { 구매: pagesToTheCap(5), '구매@20250105': [page([7], 1)] })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events.filter((event) => event.startsWith('start'))).toEqual(['start 구매'])
      expect(h.events.slice(-6)).toEqual([
        `store 구매 p${CAP}`, 'narrow 구매 20250101-20250829 to 20250105',
        'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
      ])
      expect(h.requests.slice(-3)).toEqual([`구매 20250101-20250829 p${CAP}`, '구매 20250101-20250105 p1', '구매 20250101-20250105 p2'])
      expect(h.requests).not.toContain(`구매 20250101-20250829 p${CAP + 1}`)
    })

    it('walks on when page 1 of the narrowed window starts later in the day than the cap page\'s oldest post', async () => {
      // The live case: "구매" narrowed to 01-10, and its page 1 began late on 01-10.
      const lateOnJanuary10 = { ...page([7], 1), items: [postAt(7, Date.UTC(2025, 0, 10, 14))] }
      const h = harness([query('구매', 1)], { 구매: pagesToTheCap(10), '구매@20250110': [lateOnJanuary10] })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events.slice(-5)).toEqual(['narrow 구매 20250101-20250829 to 20250110', 'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded'])
    })

    it('steps one day earlier when the oldest day is already the end of the window', async () => {
      const h = harness([query('구매', 1, null, false, '20250105')], { '구매@20250105': pagesToTheCap(5, 5), '구매@20250104': [page([7], 1)] })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events).toContain('narrow 구매 20250101-20250829 to 20250104')
      expect(h.requests.slice(-2)).toEqual(['구매 20250101-20250104 p1', '구매 20250101-20250104 p2'])
    })

    it('completes the query when narrowing would fall before the window', async () => {
      const h = harness([query('구매', 1, null, false, '20250101')], { '구매@20250101': pagesToTheCap(1, 1) })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events.slice(-2)).toEqual([`store 구매 p${CAP}`, 'finish succeeded'])
      expect(h.events.some((event) => event.startsWith('narrow'))).toBe(false)
      expect(h.requests).toHaveLength(CAP)
    })

    it('resumes a narrowed query in its narrower window from its last stored page', async () => {
      const h = harness([query('구매', 1, 3, false, '20250105')], { '구매@20250105': [page([1], 9), page([2], 9), page([3], 9)] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.requests).toEqual(['구매 20250101-20250105 p3', '구매 20250101-20250105 p4'])
    })

    const ON_JANUARY_2 = { ...page([7], 1), items: [postAt(7, januaryNoon(2))] }

    it('narrows a query that resumes on its stored cap page', async () => {
      // The live case: "구매" stored page 80 and failed on the empty page after it.
      const h = harness([query('구매', 1, CAP)], { 구매: pagesToTheCap(2), '구매@20250102': [ON_JANUARY_2] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.requests).toEqual([`구매 20250101-20250829 p${CAP}`, '구매 20250101-20250102 p1', '구매 20250101-20250102 p2'])
      expect(h.events.at(-1)).toBe('finish succeeded')
    })

    it('leaves a narrowed query for the next block when the budget runs out at the narrowing', async () => {
      const h = harness([query('구매', 1, CAP)], { 구매: pagesToTheCap(2), '구매@20250102': [ON_JANUARY_2] })
      h.runner.start({ maxPages: 1 })
      await h.settle()
      expect(h.events).toEqual([
        'start 구매', `read 구매 p${CAP}`, `store 구매 p${CAP}`, 'narrow 구매 20250101-20250829 to 20250102', 'finish partial PAGE_BUDGET_SPENT',
      ])
      expect(h.requests).toEqual([`구매 20250101-20250829 p${CAP}`])
    })

    it('narrows at the empty zero page after a full page, before the cap page', async () => {
      const h = harness([query('구매', 1)], { 구매: [fullPage(900, 20), fullPage(800, 20), fullPage(700, 5), ZEROS], '구매@20250105': [page([7], 1)] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events.slice(-7)).toEqual([
        'store 구매 p3', 'read 구매 p4', 'narrow 구매 20250101-20250829 to 20250105',
        'read 구매 p1', 'store 구매 p1', 'read 구매 p2', 'finish succeeded',
      ])
      expect(h.requests.slice(-3)).toEqual(['구매 20250101-20250829 p4', '구매 20250101-20250105 p1', '구매 20250101-20250105 p2'])
    })

    it('ends the query at the empty zero page after a page that was not full', async () => {
      const h = harness([query('글렌', 1)], { 글렌: [page([1, 2], 2), ZEROS] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'finish succeeded'])
    })

    it('ends the query at an empty page with its pageInfo after a full page', async () => {
      const h = harness([query('글렌', 1)], { 글렌: [fullPage(900, 5)] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events).toEqual(['start 글렌', 'read 글렌 p1', 'store 글렌 p1', 'read 글렌 p2', 'finish succeeded'])
    })

    it('ends a query with no results at its empty zero first page', async () => {
      const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [ZEROS], 구매: [page([4], 1)] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events.slice(0, 3)).toEqual(['start 글렌', 'read 글렌 p1', 'finish succeeded'])
    })

    it('fails, ending the block, when a resumed query first reads the empty zero page', async () => {
      const h = harness([query('구매', 1, 4), query('글렌', 2)], { 구매: [fullPage(900, 20), fullPage(800, 20), fullPage(700, 5), ZEROS], 글렌: [page([4], 1)] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events).toEqual(['start 구매', 'read 구매 p4', 'finish failed BOARD_SEARCH_CAP_UNCLEAR: page 4'])
    })

    it('fails, ending the block, when the first page of the window it narrowed to is empty', async () => {
      const h = harness([query('구매', 1), query('글렌', 2)], { 구매: pagesToTheCap(5), 글렌: [page([4], 1)] })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events.slice(-4)).toEqual([
        `store 구매 p${CAP}`, 'narrow 구매 20250101-20250829 to 20250105', 'read 구매 p1', 'finish failed BOARD_SEARCH_SEGMENT_EMPTY: segment to 20250105',
      ])
      expect(h.events.some((event) => event.startsWith('start 글렌'))).toBe(false)
    })

    it('ends the query when the window it stepped back a day to is empty from page 1', async () => {
      // Nothing on 01-04 was seen before the step back: an empty window is an end.
      const h = harness([query('구매', 1, null, false, '20250105')], { '구매@20250105': pagesToTheCap(5, 5) })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events.slice(-3)).toEqual(['narrow 구매 20250101-20250829 to 20250104', 'read 구매 p1', 'finish succeeded'])
    })

    it('fails when a resumed narrowed query finds its stored first page empty', async () => {
      const h = harness([query('구매', 1, 1, false, '20250105'), query('글렌', 2)], { 글렌: [page([4], 1)] })
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events).toEqual(['start 구매', 'read 구매 p1', 'finish failed BOARD_SEARCH_SEGMENT_EMPTY: segment to 20250105'])
    })

    it('ends a resumed narrowed query whose first page was never stored and is empty', async () => {
      const h = harness([query('구매', 1, null, false, '20250105')], {})
      h.runner.start({ maxPages: 10 })
      await h.settle()
      expect(h.events).toEqual(['start 구매', 'read 구매 p1', 'finish succeeded'])
    })

    it('does not narrow at a full page before the cap, nor at a cap page that is not full', async () => {
      const full = Array.from({ length: CAFE_BOARD_SEARCH.perPage }, (_, item) => item + 1)
      const short = pagesToTheCap(5).map((each, index) => (index === CAP - 1 ? { ...each, items: each.items.slice(1) } : each))
      const h = harness([query('글렌', 1), query('구매', 2)], { 글렌: [page(full, 50)], 구매: short })
      h.runner.start({ maxPages: CAP + 10 })
      await h.settle()
      expect(h.events.some((event) => event.startsWith('narrow'))).toBe(false)
      expect(h.requests.slice(0, 2)).toEqual(['글렌 20250101-20250829 p1', '글렌 20250101-20250829 p2'])
      expect(h.requests.at(-1)).toBe(`구매 20250101-20250829 p${CAP + 1}`)
    })
  })
})
