import { describe, expect, it } from 'vitest'
import { createArticleProbeRunner } from '../../src/desktop/articleProbeRunner.js'
import type { ArticleFetcher } from '../../src/desktop/articleFetcher.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'
import type { CollectionBlockEnd } from '../../src/desktop/collectionBlockEnd.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { ArticleProbeRepository } from '../../src/desktop/collection-db/articleProbeRepository.js'
import type { CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import type { CafeArticleRead } from '../../src/shared/cafeArticleRead.js'
import type { CollectionPacing } from '../../src/shared/collectionPacing.js'

const NO_WAIT: CollectionPacing = {
  perPage: { minSeconds: 0, maxSeconds: 0 },
  everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
  everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
}
const WINDOW = { fromDay: '20250101', toDay: '20250829' }

const live = (postId: string, boardId: string, isNotice = false): CafeArticleRead => ({
  kind: 'article',
  isNotice,
  post: {
    cafeId: '14538121', postId, boardId, boardName: '게시판', title: 't', prefix: null, authorId: null, authorNickname: null,
    postedAt: Date.UTC(2025, 5, 4), viewCount: 0, commentCount: 0, replyCount: null, isNotice: false,
  } satisfies CollectedPostMetadata,
})
const DELETED: CafeArticleRead = { kind: 'absent', status: 404, code: '4003' }
const LOGIN: CafeArticleRead = { kind: 'absent', status: 401, code: '0004' }

function harness(
  ids: string[],
  answers: Record<string, CafeArticleRead | string>,
  setup: {
    readonly storage?: boolean
    readonly connected?: boolean
    /** Ids another walk stored before their turn, with their board. */
    readonly storedBefore?: Record<string, string>
    readonly noJob?: boolean
    readonly startRejects?: boolean
    readonly sweepRejects?: boolean
    readonly failedFinishRejects?: boolean
    readonly onRead?: (postId: string) => void
  } = {},
) {
  const events: string[] = []
  const errors: string[] = []
  const sweeps: number[] = []
  /** What the runner asked of the repository, by window. */
  const asked: string[] = []
  const waiting = [...ids]
  const repository: ArticleProbeRepository = {
    readJob: async (window) => {
      asked.push(`job ${window.fromDay}-${window.toDay}`)
      return setup.noJob === true ? null : { fromDay: '20250101', toDay: '20250829', total: ids.length, probed: ids.length - waiting.length, stored: 0, deleted: 0, unreadable: 0, otherBoard: 0, notice: 0 }
    },
    createJob: async () => 0,
    listCollectedBoardIds: async () => ['137'],
    nextWaitingId: async (window) => {
      asked.push(`ids ${window.fromDay}-${window.toDay}`)
      return waiting[0] ?? null
    },
    storedBoardOf: async (postId) => setup.storedBefore?.[postId] ?? null,
    reconcileOrphanedRuns: async () => {
      if (setup.sweepRejects === true) throw new Error('database went away')
      sweeps.push(events.length)
      return 0
    },
    startRun: async (input) => {
      if (setup.startRejects === true) throw new Error('duplicate key value violates unique constraint "runs_one_running_feed"')
      events.push(`start ${input.fromDay}-${input.toDay}`)
    },
    recordPageRequest: async () => undefined,
    recordVerdict: async (input) => {
      waiting.splice(waiting.indexOf(input.postId), 1)
      events.push(`${input.postId} ${input.verdict.outcome}${input.requested ? '' : ' (no request)'}`)
    },
    finishRun: async (_id, status, reason) => {
      events.push(`finish ${status}${reason === null ? '' : ' ' + reason}`)
      if (status === 'failed' && setup.failedFinishRejects === true) throw new Error('database went away')
    },
    readLastRun: async () => null,
  }
  const fetcher: ArticleFetcher = {
    read: async (postId) => {
      events.push(`read ${postId}`)
      setup.onRead?.(postId)
      const answer = answers[postId]
      if (typeof answer === 'string') throw new CollectionPageError(answer, `id ${postId}`)
      if (answer === undefined) throw new Error(`no answer for ${postId}`)
      return answer
    },
  }
  let id = 0
  const runner = createArticleProbeRunner({
    repository: () => (setup.storage === false ? null : repository), fetcher, isConnected: () => setup.connected !== false, clock: { now: () => 0 }, random: { intInclusive: (min: number) => min },
    pacing: () => NO_WAIT, sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => `run-${++id}`,
    onError: (error) => { errors.push(error instanceof Error ? error.message : String(error)) },
  })
  const settle = async () => { while (runner.isRunning()) await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { runner, events, errors, sweeps, asked, settle }
}

describe('articleProbeRunner', () => {
  it('reads each waiting id in order and records what the cafe said', async () => {
    const h = harness(['2', '3', '4', '5', '6'], { 2: live('2', '137'), 3: DELETED, 4: LOGIN, 5: live('5', '188'), 6: live('6', '137', true) })
    expect(h.runner.start({ maxPages: 10, window: WINDOW })).toEqual({ kind: 'started' })
    await h.settle()
    expect(h.events).toEqual([
      'start 20250101-20250829',
      'read 2', '2 stored', 'read 3', '3 deleted', 'read 4', '4 unreadable', 'read 5', '5 other_board', 'read 6', '6 notice',
      'finish succeeded',
    ])
  })

  it('reads the job and the waiting ids of the window it was started on', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10, window: { fromDay: '20240101', toDay: '20250102' } })
    await h.settle()
    expect(new Set(h.asked)).toEqual(new Set(['job 20240101-20250102', 'ids 20240101-20250102']))
  })

  it('closes an id another walk stored meanwhile without a request, and without spending the budget', async () => {
    const h = harness(['2', '3'], { 3: DELETED }, { storedBefore: { 2: '137' } })
    h.runner.start({ maxPages: 1, window: WINDOW })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', '2 stored (no request)', 'read 3', '3 deleted', 'finish succeeded'])
  })

  it('stops where the budget runs out and leaves the rest waiting', async () => {
    const h = harness(['2', '3', '4'], { 2: DELETED, 3: DELETED, 4: DELETED })
    h.runner.start({ maxPages: 2, window: WINDOW })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', '2 deleted', 'read 3', '3 deleted', 'finish partial PAGE_BUDGET_SPENT'])
  })

  it('ends the block at an answer it does not know, leaving that id waiting', async () => {
    const h = harness(['2', '3'], { 2: { kind: 'absent', status: 500, code: '9999' }, 3: DELETED })
    h.runner.start({ maxPages: 10, window: WINDOW })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', 'finish failed ARTICLE_PROBE_UNKNOWN_ANSWER: id 2 500 9999'])
  })

  it('ends the block at a read the extension could not make, leaving that id waiting', async () => {
    const h = harness(['2', '3'], { 2: 'ARTICLE_HTTP_ERROR', 3: DELETED })
    h.runner.start({ maxPages: 10, window: WINDOW })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', 'finish failed ARTICLE_HTTP_ERROR: id 2'])
    expect(h.runner.blockFailure()).toBeNull()
  })

  it('ends the block at a stop, keeping the id read before it', async () => {
    let stop = (): void => undefined
    const h = harness(['2', '3'], { 2: DELETED, 3: DELETED }, { onRead: (postId) => { if (postId === '2') stop() } })
    stop = () => h.runner.stop()
    h.runner.start({ maxPages: 10, window: WINDOW })
    await h.settle()
    expect(h.events).toEqual(['start 20250101-20250829', 'read 2', '2 deleted', 'finish interrupted ABORTED'])
  })

  it('starts no run without a job, or with every id answered', async () => {
    const none = harness([], {}, { noJob: true })
    none.runner.start({ maxPages: 10, window: WINDOW })
    await none.settle()
    expect(none.events).toEqual([])
    const done = harness([], {})
    done.runner.start({ maxPages: 10, window: WINDOW })
    await done.settle()
    expect(done.events).toEqual([])
  })

  it('refuses a second start, a start without storage and a start with the extension away', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10, window: WINDOW })
    expect(h.runner.start({ maxPages: 10, window: WINDOW })).toEqual({ kind: 'refused', reason: 'ALREADY_RUNNING' })
    await h.settle()
    expect(harness(['2'], {}, { storage: false }).runner.start({ maxPages: 10, window: WINDOW })).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
    expect(harness(['2'], {}, { connected: false }).runner.start({ maxPages: 10, window: WINDOW })).toEqual({ kind: 'refused', reason: 'BRIDGE_OFFLINE' })
  })

  it('closes probe runs left running before it starts its own, once per block', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10, window: WINDOW })
    await h.settle()
    expect(h.sweeps).toEqual([0])
    expect(h.events[0]).toBe('start 20250101-20250829')
  })

  it('shows the requests this block has made of its budget, and nothing between blocks', async () => {
    const seen: string[] = []
    let look = (): void => undefined
    const h = harness(['2', '3'], { 2: DELETED, 3: DELETED }, { onRead: () => look() })
    look = () => {
      const progress = h.runner.progress()
      seen.push(progress === null ? 'none' : `${progress.requested}/${progress.maxPages}`)
    }
    expect(h.runner.progress()).toBeNull()
    h.runner.start({ maxPages: 10, window: WINDOW })
    await h.settle()
    expect(seen).toEqual(['1/10', '2/10'])
    expect(h.runner.progress()).toBeNull()
  })

  describe('a block that fails with no run row to say why', () => {
    it('keeps the failure when its run cannot be started', async () => {
      const h = harness(['2'], { 2: DELETED }, { startRejects: true })
      h.runner.start({ maxPages: 10, window: WINDOW })
      await h.settle()
      expect(h.events).toEqual([])
      expect(h.runner.blockFailure()).toEqual({
        code: 'COLLECTION_FAILURE',
        stopReason: 'COLLECTION_FAILURE: Error: duplicate key value violates unique constraint "runs_one_running_feed"',
        atMs: 0,
      })
    })

    it('keeps the failure, and still reports it, when the walk itself throws', async () => {
      const h = harness(['2'], {}, { sweepRejects: true })
      h.runner.start({ maxPages: 10, window: WINDOW })
      await h.settle()
      expect(h.runner.blockFailure()).toEqual({ code: 'COLLECTION_FAILURE', stopReason: 'COLLECTION_FAILURE: Error: database went away', atMs: 0 })
      expect(h.errors).toEqual(['database went away'])
    })

    it('forgets it when the next block starts', async () => {
      const h = harness(['2'], {}, { startRejects: true })
      h.runner.start({ maxPages: 10, window: WINDOW })
      await h.settle()
      expect(h.runner.blockFailure()).not.toBeNull()
      h.runner.start({ maxPages: 10, window: WINDOW })
      expect(h.runner.blockFailure()).toBeNull()
      await h.settle()
    })
  })

  it('reports a failed run it could not close, and frees the lock after', async () => {
    const h = harness(['2'], { 2: 'ARTICLE_HTTP_ERROR' }, { failedFinishRejects: true })
    h.runner.start({ maxPages: 10, window: WINDOW })
    await h.settle()
    expect(h.errors).toEqual(['database went away'])
    expect(h.runner.start({ maxPages: 10, window: WINDOW })).toEqual({ kind: 'started' })
    await h.settle()
  })

  it('says how each block ended', async () => {
    const ended = (h: ReturnType<typeof harness>, maxPages: number) =>
      new Promise<CollectionBlockEnd>((resolve) => {
        h.runner.start({ maxPages, window: WINDOW, onBlockEnd: (end) => { expect(h.runner.isRunning()).toBe(false); resolve(end) } })
      })
    expect(await ended(harness(['2', '3'], { 2: DELETED, 3: DELETED }), 10)).toEqual({ requests: 2, endedBy: 'drained' })
    expect(await ended(harness(['2', '3', '4'], { 2: DELETED, 3: DELETED, 4: DELETED }), 2)).toEqual({ requests: 2, endedBy: 'budget' })
    expect(await ended(harness(['2'], { 2: 'ARTICLE_HTTP_ERROR' }), 10)).toEqual({ requests: 1, endedBy: 'failed' })
    expect(await ended(harness([], {}, { noJob: true }), 10)).toEqual({ requests: 0, endedBy: 'drained' })
    let stop = (): void => undefined
    const stopped = harness(['2', '3'], { 2: DELETED, 3: DELETED }, { onRead: () => stop() })
    stop = () => stopped.runner.stop()
    expect(await ended(stopped, 10)).toMatchObject({ endedBy: 'stopped' })
  })

  it('says a block a stop ended was stopped, even when the read in hand then failed', async () => {
    let stop = (): void => undefined
    const h = harness(['2', '3'], { 2: 'ARTICLE_HTTP_ERROR', 3: DELETED }, { onRead: () => stop() })
    stop = () => h.runner.stop()
    const end = await new Promise<CollectionBlockEnd>((resolve) => { h.runner.start({ maxPages: 10, window: WINDOW, onBlockEnd: resolve }) })
    expect(end).toEqual({ requests: 1, endedBy: 'stopped' })
  })

  it('reports a block-end callback that throws, and can start again', async () => {
    const h = harness(['2'], { 2: DELETED })
    h.runner.start({ maxPages: 10, window: WINDOW, onBlockEnd: () => { throw new Error('next walk refused') } })
    await h.settle()
    expect(h.errors).toEqual(['next walk refused'])
    expect(h.runner.start({ maxPages: 10, window: WINDOW })).toEqual({ kind: 'started' })
    await h.settle()
  })
})
