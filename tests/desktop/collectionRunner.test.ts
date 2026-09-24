import { describe, expect, it } from 'vitest'
import { createCollectionRunner } from '../../src/desktop/collectionRunner.js'
import type { CollectionRepository } from '../../src/desktop/collection-db/repository.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'

function post(id: string, postedAt: number): CollectedPostMetadata {
  return { cafeId: '14538121', postId: id, boardId: '1', boardName: '게시판', title: null, prefix: null, authorId: null, authorNickname: null, postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false }
}
function page(items: CollectedPostMetadata[], last = 2): CollectedArticlePage {
  return { items, pageInfo: { lastNavigationPageNumber: last, visibleNextButton: true, totalArticleCount: 9 }, pageIdentity: `p:${items.map((i) => i.postId).join(',')}` }
}

/** A cafe of tiny boards: each has one page inside the period and then ends. */
function transport(pagesByMenu: Record<string, Record<number, CollectedArticlePage>>, failing: string[] = []) {
  const asked: string[] = []
  return {
    asked,
    transport: {
      isConnected: () => true,
      request: async (message: { menuId: string; page: number; requestId: string }) => {
        asked.push(`${message.menuId}:${message.page}`)
        if (failing.includes(message.menuId)) return { type: 'ERROR', requestId: message.requestId, code: 'BOARD_PAGE_HTTP_ERROR', message: '' }
        const found = pagesByMenu[message.menuId]?.[message.page]
        return { type: 'BOARD_PAGE_COLLECTED', requestId: message.requestId, page: message.page, result: found ?? page([post(`fresh-${message.menuId}`, 999)], 1) }
      },
    } as never,
  }
}

function repository() {
  const finished: string[] = []
  const repo: CollectionRepository = {
    readFeedState: async () => null,
    listFeedStates: async () => [],
    replaceJob: async () => [],
    startRun: async (input) => ({ stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0, complete: false, forced: false, horizonReached: false, targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs }),
    recordPageRequest: async () => undefined,
    finishRun: async (id, status, reason) => { finished.push(`${status}:${reason ?? ''}`) },
    markHorizonReached: async () => undefined,
    setForced: async () => undefined,
    reconcileOrphanedRuns: async () => 0,
    persistPage: async (input) => ({ kind: 'stored', insertedPostCount: input.page.items.length, updatedPostCount: 0, nextStateVersion: 1, anchorPostId: input.page.items.at(-1)!.postId }),
  }
  return { repo, finished }
}

function runner(repo: CollectionRepository, t: ReturnType<typeof transport>['transport'], onFinished?: (r: unknown) => void) {
  return createCollectionRunner({
    repository: () => repo, transport: t, clock: { now: () => 1_000 }, random: { intInclusive: () => 0 },
    sleep: async () => undefined, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => 'id',
    onFinished: onFinished as never,
  })
}

const BASE_PAUSE = 5_000
const TWENTIETH_BREAK = 120_000

/**
 * Random at its low bound, so every pause is exact; each read records how long
 * the walk slept since the read before it.
 */
function pacedRunner(repo: CollectionRepository, t: ReturnType<typeof transport>['transport']) {
  const pauses: number[] = []
  let slept = 0
  const request = (t as { request: (m: never) => Promise<unknown> }).request
  ;(t as { request: unknown }).request = async (message: never) => { pauses.push(slept); slept = 0; return request(message) }
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => { resolveDone = resolve })
  const paced = createCollectionRunner({
    repository: () => repo, transport: t, clock: { now: () => 1_000 }, random: { intInclusive: (low) => low },
    sleep: async (ms) => { slept += ms }, isSessionBusy: () => false, lock: createCollectionLock(), newId: () => 'id',
    onFinished: () => resolveDone(),
  })
  return { runner: paced, done, pauses }
}

const inPeriod = (id: string) => page([post(id, 150)], 1)
const feeds = [{ feedKind: 'board' as const, menuId: '137' }, { feedKind: 'board' as const, menuId: '189' }, { feedKind: 'board' as const, menuId: '205' }]

describe('collection runner over a queue of feeds', () => {
  it('walks the feeds in order within one budget', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') }, '205': { 1: inPeriod('c') } })
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    expect(r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds, resumeFromCheckpoint: true })).toEqual({ kind: 'started' })
    await done
    // Each board: page 1 probed then collected, page 2 falls back → end. Three boards.
    // The orchestrator probes to find the start page, then collects it; both requests go through the transport.
    expect(t.asked).toEqual(['137:1', '137:1', '137:2', '189:1', '189:1', '189:2', '205:1', '205:1', '205:2'])
    expect(finished).toEqual(['succeeded:', 'succeeded:', 'succeeded:'])
  })

  it('stops when the budget is spent and leaves the rest for the next block', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') }, '205': { 1: inPeriod('c') } })
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    // Budget of 4: feed 137 uses 3 reads (probe+collect+fallback). Feed 189 gets 1 read (probe hits MAX_PAGE_LIMIT on collect).
    r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 4, feeds, resumeFromCheckpoint: true })
    await done
    expect(t.asked).toEqual(['137:1', '137:1', '137:2', '189:1'])
    expect(finished).toEqual(['succeeded:', 'partial:PAGE_BUDGET_SPENT'])
  })

  it('goes on to the next feed when one fails', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '205': { 1: inPeriod('c') } }, ['189'])
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds, resumeFromCheckpoint: true })
    await done
    expect(finished).toEqual(['succeeded:', 'failed:BOARD_PAGE_HTTP_ERROR', 'succeeded:'])
  })

  it('waits before the next feed\'s first read', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') } })
    const { repo } = repository()
    const paced = pacedRunner(repo, t.transport)
    paced.runner.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds: feeds.slice(0, 2), resumeFromCheckpoint: true })
    await paced.done
    expect(t.asked).toEqual(['137:1', '137:1', '137:2', '189:1', '189:1', '189:2'])
    expect(paced.pauses).toEqual([0, BASE_PAUSE, BASE_PAUSE, BASE_PAUSE, BASE_PAUSE, BASE_PAUSE])
  })

  it('takes the every-20th break on the block\'s count, not each feed\'s', async () => {
    // Nine three-read boards: none reaches twenty alone, the block does on its seventh.
    const small = Array.from({ length: 9 }, (_, index) => ({ feedKind: 'board' as const, menuId: `${300 + index}` }))
    const t = transport(Object.fromEntries(small.map((feed) => [feed.menuId, { 1: inPeriod(`p${feed.menuId}`) }])))
    const { repo } = repository()
    const paced = pacedRunner(repo, t.transport)
    paced.runner.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds: small, resumeFromCheckpoint: true })
    await paced.done
    expect(paced.pauses).toHaveLength(27)
    expect(t.asked[19]).toBe('306:1')
    expect(paced.pauses[19]).toBe(BASE_PAUSE + TWENTIETH_BREAK)
    expect(paced.pauses.filter((pause, index) => index !== 0 && index !== 19)).toEqual(Array(25).fill(BASE_PAUSE))
  })

  it('does not go on after a stop', async () => {
    const t = transport({ '137': { 1: inPeriod('a') }, '189': { 1: inPeriod('b') } })
    const { repo, finished } = repository()
    let r!: ReturnType<typeof runner>
    const done = new Promise<void>((resolve) => { r = runner(repo, t.transport, () => resolve()) })
    const original = (t.transport as { request: (m: never) => unknown }).request
    ;(t.transport as { request: unknown }).request = async (message: never) => { r.stop(); return original(message) }
    r.start({ range: { startMs: 100, endMs: 200 }, kind: 'incremental', maxPages: 30, feeds: feeds.slice(0, 2), resumeFromCheckpoint: true })
    await done
    expect(finished).toEqual(['interrupted:ABORTED'])
    expect(t.asked.filter((a) => a.startsWith('189'))).toEqual([])
  })
})
