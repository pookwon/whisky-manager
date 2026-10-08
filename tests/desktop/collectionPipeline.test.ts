import { describe, expect, it } from 'vitest'
import { BOARD_SEARCH_GIVE_UP_STREAK } from '../../src/desktop/boardSearchYield.js'
import { createCollectionPipeline, type CollectionPipelineStores } from '../../src/desktop/collectionPipeline.js'
import type { CollectionBlockEnd, OnCollectionBlockEnd } from '../../src/desktop/collectionBlockEnd.js'
import type { CollectionRepository, StoredFeedState } from '../../src/desktop/collection-db/repository.js'
import type { BoardSearchQueryState, BoardSearchRepository } from '../../src/desktop/collection-db/boardSearchRepository.js'
import type { ArticleProbeJob, ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { CollectionRunner } from '../../src/desktop/collectionRunner.js'
import type { BoardSearchRunner } from '../../src/desktop/boardSearchRunner.js'
import type { ArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'
import type { BoardSearchLastRun, BoardSearchLastRunQuery } from '../../src/desktop/collection-db/boardSearchLastRunQuery.js'

const START = Date.UTC(2023, 11, 31, 15)
const END = Date.UTC(2025, 0, 1, 15)
const PERIOD = { fromDay: '20240101', toDay: '20250102' }

function feed(menuId: string, queueOrder: number, facts: Partial<StoredFeedState> = {}): StoredFeedState {
  return {
    feed: { feedKind: 'board', menuId }, queueOrder, boardName: null,
    stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0,
    targetStartMs: START, targetEndMs: END, complete: false, forced: false, horizonReached: false,
    searchExtended: false, searchFinished: false, probeFinished: false, ...facts,
  }
}

function query(boardId: string, q: string, order: number, complete = false, fromDay = '20240101', belowProbeYield = false): BoardSearchQueryState {
  return { boardId, query: q, fromDay, toDay: '20240301', segmentToDay: null, queueOrder: order, expectedGain: 5, lastCommittedPage: null, insertedCount: 0, totalCount: null, complete, belowProbeYield, lastRunId: null }
}

function harness(setup: { feeds: StoredFeedState[]; queries?: BoardSearchQueryState[]; probe?: ArticleProbeJob | null; made?: number; titles?: string[]; lastRuns?: Record<string, BoardSearchLastRun>; failRead?: boolean; failStart?: 'list' | 'search' | 'probe' }) {
  const calls: string[] = []
  let feeds = setup.feeds
  let queries = setup.queries ?? []
  let probe = setup.probe ?? null
  const mark = (menuId: string | null, facts: Partial<StoredFeedState>) => {
    feeds = feeds.map((row) => (menuId === null || row.feed.menuId === menuId ? { ...row, ...facts } : row))
  }
  const collection = {
    listFeedStates: async () => {
      if (setup.failRead === true) throw new Error('database went away')
      return feeds
    },
    markSearchExtended: async (boardId: string) => { calls.push(`extended ${boardId}`); mark(boardId, { searchExtended: true }) },
    markSearchFinished: async (boardId: string) => { calls.push(`searched ${boardId}`); mark(boardId, { searchFinished: true }) },
    markProbeFinished: async () => { calls.push('probed'); mark(null, { probeFinished: true }) },
  } as unknown as CollectionRepository
  const boardSearch = {
    listQueries: async () => queries,
    readBoardTitles: async () => setup.titles ?? [],
    oldestPostedAtMs: async () => Date.UTC(2024, 2, 1, 3),
    replaceJob: async (input: { boardId: string; fromDay: string; queries: { query: string }[] }) => {
      calls.push(`replace ${input.boardId} ${input.fromDay} ${input.queries.map((q) => q.query).join(',')}`)
      queries = input.queries.map((q, index) => query(input.boardId, q.query, index + 1, false, input.fromDay))
    },
    extendJob: async (input: { queries: { query: string }[] }) => { calls.push(`extend ${input.queries.map((q) => q.query).join(',')}`); return input.queries.length },
  } as unknown as BoardSearchRepository
  const boardSearchLastRuns: BoardSearchLastRunQuery = {
    read: async (window) => {
      calls.push(`last runs ${window.boardId} ${window.fromDay}-${window.toDay}`)
      return new Map(Object.entries(setup.lastRuns ?? {}))
    },
  }
  const articleProbe = {
    readJob: async () => probe,
    createJob: async (window: { fromDay: string; toDay: string }) => {
      calls.push(`create ${window.fromDay}-${window.toDay}`)
      const made = setup.made ?? 3
      if (made > 0) probe = { fromDay: window.fromDay, toDay: window.toDay, total: made, probed: 0, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 }
      return made
    },
  } as unknown as ArticleProbeRepository
  const ends: { list?: OnCollectionBlockEnd | undefined; search?: OnCollectionBlockEnd | undefined; probe?: OnCollectionBlockEnd | undefined } = {}
  let running = false
  const runner = (name: 'list' | 'search' | 'probe') => ({
    start: (request: { maxPages: number; requestsBefore?: number; onBlockEnd?: OnCollectionBlockEnd; window?: { fromDay: string; toDay: string }; feeds?: { menuId: string }[] }) => {
      if (setup.failStart === name) throw new Error('setting unreadable')
      calls.push(`${name} ${request.maxPages}${request.window ? ` ${request.window.fromDay}-${request.window.toDay}` : ''}${request.feeds ? ` ${request.feeds.map((f) => f.menuId).join(',')}` : ''}${request.requestsBefore ? ` after ${request.requestsBefore}` : ''}`)
      ends[name] = request.onBlockEnd
      running = true
      return { kind: 'started' as const }
    },
    stop: () => { calls.push(`stop ${name}`) },
    isRunning: () => running,
  })
  const errors: unknown[] = []
  /** Whether the pipeline still held its chain when each error was reported. */
  const runningWhenTold: boolean[] = []
  const pipeline = createCollectionPipeline({
    stores: () => ({ collection, boardSearch, boardSearchLastRuns, articleProbe }) satisfies CollectionPipelineStores,
    listRunner: runner('list') as unknown as CollectionRunner,
    searchRunner: runner('search') as unknown as BoardSearchRunner,
    probeRunner: runner('probe') as unknown as ArticleProbeRunner,
    clock: { now: () => 0 },
    onError: (error) => {
      errors.push(error)
      runningWhenTold.push(pipeline.isRunning())
    },
    onSkipped: (message) => calls.push(`skipped ${message}`),
  })
  /** Ends the named runner's block as the runner would: lock released, then told. */
  const end = async (name: 'list' | 'search' | 'probe', blockEnd: CollectionBlockEnd, then: Partial<{ feeds: StoredFeedState[]; queries: BoardSearchQueryState[]; probe: ArticleProbeJob | null }> = {}) => {
    feeds = then.feeds ?? feeds
    queries = then.queries ?? queries
    probe = then.probe === undefined ? probe : then.probe
    running = false
    ends[name]?.(blockEnd)
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { pipeline, calls, errors, runningWhenTold, end }
}

describe('collectionPipeline', () => {
  it('walks the list first, with the rest of its feeds', async () => {
    const h = harness({ feeds: [feed('189', 1, { complete: true }), feed('137', 2)] })
    expect(await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })).toEqual({ kind: 'started' })
    expect(h.calls).toEqual(['list 100 137'])
    expect(h.pipeline.isRunning()).toBe(true)
  })

  it('goes from the list to the search of a board it could not finish in the same block, with what is left', async () => {
    const h = harness({ feeds: [feed('137', 1)], titles: Array.from({ length: 6 }, () => '홈플') })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    await h.end('list', { requests: 40, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true })] })
    expect(h.calls).toEqual(['list 100 137', 'replace 137 20240101 홈플', 'extended 137', 'search 60 after 40'])
  })

  it('adopts the search job of the same board and start day, keeping its progress and giving it the longer words once', async () => {
    const h = harness({
      feeds: [feed('137', 1, { horizonReached: true })],
      queries: [query('137', '홈플', 1, true), query('137', '구매', 2)],
      titles: ['월드컵 홈플러스', '홈플러스', '홈플러스', '홈플러스', '홈플러스'],
    })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['extend 홈플러스', 'extended 137', 'search 50'])
  })

  it('walks an adopted search job again when its every query is done but the longer words add one', async () => {
    const h = harness({
      feeds: [feed('137', 1, { horizonReached: true })],
      queries: [query('137', '홈플', 1, true), query('137', '구매', 2, true)],
      titles: ['월드컵 홈플러스', '홈플러스', '홈플러스', '홈플러스', '홈플러스'],
    })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['extend 홈플러스', 'extended 137', 'search 50'])
    expect(h.calls).not.toContain('searched 137')
  })

  it('replaces a search job left for another board or another start day', async () => {
    const h = harness({ feeds: [feed('205', 1, { horizonReached: true })], queries: [query('137', '홈플', 1, false, '20250101')], titles: Array.from({ length: 5 }, () => '득템') })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['replace 205 20240101 득템', 'extended 205', 'search 50'])
  })

  it('marks a board with nothing to search and goes on to the next', async () => {
    // No titles: the plan refuses with NO_QUERIES.
    const h = harness({ feeds: [feed('205', 1, { horizonReached: true }), feed('188', 2, { horizonReached: true, searchFinished: true })] })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['skipped search 205: NO_QUERIES', 'searched 205', 'create 20240101-20250102', 'probe 50 20240101-20250102'])
  })

  it('marks a finished search and makes the probe of the whole period', async () => {
    const h = harness({ feeds: [feed('137', 1, { horizonReached: true, searchExtended: true })], queries: [query('137', '홈플', 1, true)] })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['searched 137', 'create 20240101-20250102', 'probe 50 20240101-20250102'])
  })

  it('marks a search finished whose every unfinished query last failed on its own results', async () => {
    const h = harness({
      feeds: [feed('137', 1, { horizonReached: true, searchExtended: true })],
      queries: [query('137', '홈플', 1, true), query('137', '구매', 2)],
      lastRuns: { 구매: { status: 'failed', stopReason: 'BOARD_SEARCH_OUT_OF_WINDOW: 20231231' } },
    })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual([
      'last runs 137 20240101-20240301',
      'skipped search 137: 1 queries left failing on their own results',
      'searched 137',
      'create 20240101-20250102',
      'probe 50 20240101-20250102',
    ])
  })

  it('gives a board\'s search up to the probe once its last queries stopped paying for themselves', async () => {
    const below = Array.from({ length: BOARD_SEARCH_GIVE_UP_STREAK }, (_, index) => query('137', `w${index}`, index + 1, true, '20240101', true))
    const h = harness({
      feeds: [feed('137', 1, { horizonReached: true, searchExtended: true })],
      queries: [query('137', '글렌', 0, true), ...below, query('137', '구매기', 99)],
    })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual([
      `skipped search 137: last ${BOARD_SEARCH_GIVE_UP_STREAK} queries below the probe's yield, 1 left to the probe`,
      'searched 137',
      'create 20240101-20250102',
      'probe 50 20240101-20250102',
    ])
  })

  it('keeps searching while the run of queries below the probe\'s yield is short of giving up', async () => {
    const below = Array.from({ length: BOARD_SEARCH_GIVE_UP_STREAK - 1 }, (_, index) => query('137', `w${index}`, index + 1, true, '20240101', true))
    const h = harness({
      feeds: [feed('137', 1, { horizonReached: true, searchExtended: true })],
      queries: [...below, query('137', '구매기', 99)],
    })
    await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
    expect(h.calls).toEqual(['last runs 137 20240101-20240301', 'search 50'])
  })

  it('keeps searching while an unfinished query last failed the way every query would, or has not run', async () => {
    for (const lastRuns of [{ 구매: { status: 'failed' as const, stopReason: 'BOARD_SEARCH_HTTP_ERROR: 500' } }, {}]) {
      const h = harness({
        feeds: [feed('137', 1, { horizonReached: true, searchExtended: true })],
        queries: [query('137', '홈플', 1, true), query('137', '구매', 2)],
        lastRuns,
      })
      await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })
      expect(h.calls).toEqual(['last runs 137 20240101-20240301', 'search 50'])
    }
  })

  it('is done when the period has no hole left, and refuses to start', async () => {
    const h = harness({ feeds: [feed('189', 1, { complete: true })], made: 0 })
    expect(await h.pipeline.start({ maxPages: 50, runKind: 'backfill' })).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
    expect(h.calls).toEqual(['create 20240101-20250102', 'probed'])
    expect(h.pipeline.isRunning()).toBe(false)
  })

  it('counts the pacing of a chained stage on from every request the block made before it', async () => {
    const h = harness({ feeds: [feed('137', 1)], titles: Array.from({ length: 6 }, () => '홈플'), made: 2 })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    await h.end('list', { requests: 40, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true })] })
    await h.end('search', { requests: 25, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true, searchExtended: true, searchFinished: true })] })
    expect(h.calls.slice(-2)).toEqual(['create 20240101-20250102', 'probe 35 20240101-20250102 after 65'])
  })

  it('ends the chain when a block spent its budget, failed or was stopped', async () => {
    for (const endedBy of ['budget', 'failed', 'stopped'] as const) {
      const h = harness({ feeds: [feed('137', 1)] })
      await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
      await h.end('list', { requests: 10, endedBy }, { feeds: [feed('137', 1, { horizonReached: true })] })
      expect(h.calls).toEqual(['list 100 137'])
      expect(h.pipeline.isRunning()).toBe(false)
    }
  })

  it('starts nothing after a stop, even when the block ends with budget to spare', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    h.pipeline.stop()
    await h.end('list', { requests: 10, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true })] })
    expect(h.calls).toEqual(['list 100 137', 'stop list', 'stop search', 'stop probe'])
    expect(h.pipeline.isRunning()).toBe(false)
  })

  it('is stopping from a stop until the chain ends, and not before or after', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    expect(h.pipeline.isStopping()).toBe(false)
    h.pipeline.stop()
    expect(h.pipeline.isStopping()).toBe(true)
    await h.end('list', { requests: 10, endedBy: 'drained' }, { feeds: [feed('137', 1, { horizonReached: true })] })
    expect(h.pipeline.isStopping()).toBe(false)
  })

  it('is not stopping when a stop is asked with nothing running', () => {
    const h = harness({ feeds: [feed('137', 1)] })
    h.pipeline.stop()
    expect(h.pipeline.isStopping()).toBe(false)
  })

  it('does not go round again on a stage whose block read nothing', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    await h.end('list', { requests: 0, endedBy: 'drained' })
    expect(h.calls).toEqual(['list 100 137'])
    expect(h.pipeline.isRunning()).toBe(false)
  })

  it('refuses while running, and says when it cannot prepare a stage', async () => {
    const h = harness({ feeds: [feed('137', 1)] })
    await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })
    expect(await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })

    expect(await harness({ feeds: [] }).pipeline.start({ maxPages: 1, runKind: 'backfill' })).toEqual({ kind: 'refused', reason: 'NO_JOB' })

    const broken = harness({ feeds: [], failRead: true })
    expect(await broken.pipeline.start({ maxPages: 1, runKind: 'backfill' })).toEqual({ kind: 'refused', reason: 'STEP_FAILED' })
    expect(broken.errors).toHaveLength(1)
    expect(broken.runningWhenTold).toEqual([false])
    expect(broken.pipeline.isRunning()).toBe(false)
  })

  it('frees the chain when a stage\'s runner cannot start', async () => {
    const h = harness({ feeds: [feed('137', 1)], failStart: 'list' })
    expect(await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })).toEqual({ kind: 'refused', reason: 'STEP_FAILED' })
    expect(h.errors).toHaveLength(1)
    expect(h.runningWhenTold).toEqual([false])
    expect(h.pipeline.isRunning()).toBe(false)
    expect(await h.pipeline.start({ maxPages: 100, runKind: 'incremental' })).not.toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
  })

  it('reads the stage, and the list\'s around-the-clock flag only while the list walks', async () => {
    expect(await harness({ feeds: [feed('137', 1, { forced: true })] }).pipeline.read()).toEqual({ stage: { kind: 'list', period: PERIOD }, forced: true })
    expect(await harness({ feeds: [feed('137', 1, { complete: true, forced: true })] }).pipeline.read()).toEqual({ stage: { kind: 'probe', period: PERIOD }, forced: false })
  })
})
