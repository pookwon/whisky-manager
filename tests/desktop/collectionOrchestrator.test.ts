import { describe, expect, it } from 'vitest'
import { CollectionPageError, collectionDelayMs, createCollectionOrchestrator, findCollectionStartPage } from '../../src/desktop/collectionOrchestrator.js'
import type { CollectionRepository, PersistCollectedPageInput } from '../../src/desktop/collection-db/repository.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

const feed = { feedKind: 'all_articles' as const, menuId: '0' }
const run = { ...feed, id: '00000000-0000-4000-8000-000000000001', runKind: 'development' as const, resumeFromCheckpoint: false, targetStartMs: 200, targetEndMs: 290, startedAt: new Date(1_000) }

function post(id: string, postedAt: number): CollectedPostMetadata {
  return { cafeId: '14538121', postId: id, boardId: '1', boardName: '게시판', title: null, prefix: null, authorId: null, authorNickname: null, postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false }
}

function page(items: CollectedPostMetadata[], lastNavigationPageNumber = 100, totalArticleCount = 500): CollectedArticlePage {
  return { items, pageInfo: { lastNavigationPageNumber, visibleNextButton: true, totalArticleCount }, pageIdentity: `page:${items.map((item) => item.postId).join(',')}` }
}

function fetcher(pages: Record<number, CollectedArticlePage>) {
  return { read: async (number: number) => pages[number] ?? page([], 1) }
}

function probeReader(pages: Record<number, CollectedArticlePage>) {
  const reader = fetcher(pages)
  return { probe: reader.read, collect: reader.read, observedAt: () => new Date(0), reads: 0 }
}

function repository(conflict = false): { repo: CollectionRepository; persisted: PersistCollectedPageInput[]; finished: string[] } {
  const persisted: PersistCollectedPageInput[] = []
  const finished: string[] = []
  let version = 0
  let anchor: string | null = null
  return {
    persisted,
    finished,
    repo: {
      setForced: () => {
      throw new Error('the walk never turns the operating hours on or off')
    },
    readFeedState: async () => ({ stateVersion: version, anchorPostId: anchor, anchorPostedAtMs: null, complete: false,
    forced: false,
    cursorUpdatedAtMs: 1_000, referencePage: null, pageIdentity: null, targetStartMs: run.targetStartMs, targetEndMs: run.targetEndMs }),
      startRun: async (input) => ({ stateVersion: version, anchorPostId: anchor, anchorPostedAtMs: null, complete: false,
    forced: false,
    cursorUpdatedAtMs: 1_000, referencePage: null, pageIdentity: null, targetStartMs: input.targetStartMs, targetEndMs: input.targetEndMs }),
      recordPageRequest: async () => undefined,
      finishRun: async (_id, status, reason) => { finished.push(`${status}:${reason ?? ''}`) },
      reconcileOrphanedRuns: async () => 0,
      persistPage: async (input) => {
        persisted.push(input)
        if (conflict) return { kind: 'conflict' }
        version += 1
        anchor = input.page.items.at(-1)?.postId ?? null
        return { kind: 'stored', insertedPostCount: input.page.items.length, updatedPostCount: 0, nextStateVersion: version, anchorPostId: anchor ?? '' }
      },
    },
  }
}

function repositoryWithCheckpoint(checkpoint: {
  anchorPostId: string
  anchorPostedAtMs: number
  referencePage: number
  stateVersion: number
}) {
  const persisted: PersistCollectedPageInput[] = []
  const finished: string[] = []
  let state = {
    ...checkpoint,
    complete: false,
    forced: false,
    cursorUpdatedAtMs: 1_000,
    pageIdentity: 'previous',
    targetStartMs: run.targetStartMs,
    targetEndMs: run.targetEndMs,
  }
  const repo: CollectionRepository = {
    setForced: () => {
      throw new Error('the walk never turns the operating hours on or off')
    },
    readFeedState: async () => state,
    startRun: async () => state,
    recordPageRequest: async () => undefined,
    finishRun: async (_id, status, reason) => { finished.push(`${status}:${reason ?? ''}`) },
    reconcileOrphanedRuns: async () => 0,
    persistPage: async (input) => {
      persisted.push(input)
      const anchorPostId = input.page.items.at(-1)?.postId ?? ''
      state = { ...state, stateVersion: state.stateVersion + 1, anchorPostId, referencePage: input.referencePage }
      return {
        kind: 'stored',
        insertedPostCount: input.page.items.length,
        updatedPostCount: 0,
        duplicateObservationCount: 0,
        nextStateVersion: state.stateVersion,
        anchorPostId,
      }
    },
  }
  return { repo, persisted, finished }
}

describe('collection planning and orchestration', () => {
  it('uses exponential search and a valid bracket; silent fallback is explicit', async () => {
    const pages = {
      1: page([post('1', 300), post('2', 295)]),
      2: page([post('3', 294), post('4', 280)]),
    }
    await expect(findCollectionStartPage(probeReader(pages), 290)).resolves.toMatchObject({ page: 2 })
    await expect(findCollectionStartPage(probeReader({ 1: pages[1]!, 2: page([post('x', 300)], 1) }), 290)).rejects.toMatchObject({ code: 'TARGET_PAGE_UNAVAILABLE' })
  })

  it('walks a page whose two posts came back swapped, keeping the order the feed gave', async () => {
    // What actually stopped the collection: at depth the cafe returned two
    // ordinary posts swapped, 282 seconds apart, the same two on every read.
    // Refusing the page walled the walk off from them for days.
    //
    // They are stored in the order the feed gave, not sorted: resuming counts
    // positions in the page as delivered, so re-ordering it here would slice
    // away a post that sits after the anchor in the feed but ahead of it in
    // time — losing quietly what this used to refuse loudly.
    const { repo, persisted, finished } = repository()
    const swapped = page([post('885450', 300_000), post('885454', 360_000), post('885449', 240_000)])
    const reader = probeReader({ 1: swapped, 2: page([post('885440', 100_000)]) })
    const result = await createCollectionOrchestrator({
      repository: repo,
      fetcher: { read: (n) => reader.probe(n) },
      clock: { now: () => 1_000 },
      random: { intInclusive: (min: number) => min },
      sleep: () => Promise.resolve(),
      isSessionBusy: () => false,
      isAbortRequested: () => false,
    }).run({
      feed,
      run: { ...feed, id: 'r1', runKind: 'backfill', resumeFromCheckpoint: false, targetStartMs: 200_000, targetEndMs: 1_000_000, startedAt: new Date(0) },
      maxPages: 5,
    })

    expect(result).toMatchObject({ kind: 'succeeded' })
    expect(finished.some((line) => line.includes('TIMESTAMP_ORDER'))).toBe(false)
    expect(persisted[0]?.page.items.map((item) => item.postId)).toEqual(['885450', '885454', '885449'])
  })

  it('still refuses a page whose disorder is too wide to be the cafe wobbling', async () => {
    // A post bumped or restored carries a time hours or months from its
    // neighbours. Letting one through would end the walk at a boundary it
    // never reached, so the tolerance stops well short of that — and the
    // refusal names both posts, because the distance is what tells the two
    // faults apart.
    const { repo, finished } = repository()
    const wild = page([post('900', 300_000), post('901', 300_000 + 3 * 60 * 60 * 1000)])
    const reader = probeReader({ 1: wild })
    const result = await createCollectionOrchestrator({
      repository: repo,
      fetcher: { read: (n) => reader.probe(n) },
      clock: { now: () => 1_000 },
      random: { intInclusive: (min: number) => min },
      sleep: () => Promise.resolve(),
      isSessionBusy: () => false,
      isAbortRequested: () => false,
    }).run({
      feed,
      run: { ...feed, id: 'r2', runKind: 'backfill', resumeFromCheckpoint: false, targetStartMs: 200_000, targetEndMs: 100_000_000, startedAt: new Date(0) },
      maxPages: 5,
    })

    expect(result).toMatchObject({ kind: 'failed', code: 'BOARD_PAGE_TIMESTAMP_ORDER' })
    const reason = finished.at(-1) ?? ''
    expect(reason).toContain('901')
    expect(reason).toContain('900')
    expect(reason).toMatch(/\b10800s\b/)
    // The page's own shape, because one post out of place among forty-nine and
    // two stretches of the feed spliced together look identical in the pair.
    expect(reason).toContain('2 items, 2 runs')
    expect(reason).toContain('breaks #1(+10800s)')
  })

  it('still refuses a page that carries the same post twice', async () => {
    const { repo } = repository()
    const twice = page([post('900', 360_000), post('900', 300_000)])
    const reader = probeReader({ 1: twice })
    const result = await createCollectionOrchestrator({
      repository: repo,
      fetcher: { read: (n) => reader.probe(n) },
      clock: { now: () => 1_000 },
      random: { intInclusive: (min: number) => min },
      sleep: () => Promise.resolve(),
      isSessionBusy: () => false,
      isAbortRequested: () => false,
    }).run({
      feed,
      run: { ...feed, id: 'r3', runKind: 'backfill', resumeFromCheckpoint: false, targetStartMs: 200_000, targetEndMs: 1_000_000, startedAt: new Date(0) },
      maxPages: 5,
    })

    expect(result).toMatchObject({ kind: 'failed', code: 'BOARD_PAGE_DUPLICATE_POST' })
  })

  it('has deterministic injected delays with the required short and long breaks', () => {
    const random = { intInclusive: (min: number) => min }
    expect(collectionDelayMs(1, random)).toBe(0)
    expect(collectionDelayMs(2, random)).toBe(5_000)
    expect(collectionDelayMs(20, random)).toBe(125_000)
    expect(collectionDelayMs(100, random)).toBe(725_000)
  })

  it('filters range rows, yields while the greeting session is busy, and ends at the older boundary', async () => {
    const { repo, persisted, finished } = repository()
    const sleeps: number[] = []
    let busy = true
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: fetcher({
        1: page([post('new', 300), post('in-1', 250)]),
        2: page([post('in-2', 240), post('old', 190)]),
      }),
      clock: { now: () => 1_000 },
      random: { intInclusive: (min) => min },
      sleep: async (ms) => { sleeps.push(ms); busy = false },
      isSessionBusy: () => busy,
      isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toEqual({ kind: 'succeeded', pagesStored: 2 })
    expect(sleeps[0]).toBe(1_000)
    expect(persisted.flatMap((input) => input.page.items.map((item) => item.postId))).toEqual(['in-1', 'in-2'])
    expect(finished).toEqual(['succeeded:'])
  })

  it('records an interrupted run at a page boundary without fetching a board page', async () => {
    const { repo, persisted, finished } = repository()
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: fetcher({ 1: page([post('1', 300), post('2', 250)]) }),
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => true,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toEqual({ kind: 'interrupted', pagesStored: 0, reason: 'ABORTED' })
    expect(persisted).toHaveLength(0)
    expect(finished).toEqual(['interrupted:ABORTED'])
  })

  it('reports CAS conflict with freshly read state so the caller can reposition', async () => {
    const { repo, finished } = repository(true)
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: fetcher({ 1: page([post('1', 280), post('2', 250)]) }),
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toMatchObject({ kind: 'cas_conflict', pagesStored: 0, latestState: { stateVersion: 0 } })
    expect(finished).toEqual(['partial:CAS_CONFLICT_REPOSITION_REQUIRED'])
  })

  it('rejects empty and repeated pages, and a page past the end of the feed rather than treating them as no work', async () => {
    await expect(findCollectionStartPage(probeReader({ 1: page([]) }), 290)).rejects.toBeInstanceOf(CollectionPageError)
    await expect(findCollectionStartPage(probeReader({ 1: page([post('newer', 250), post('older', 300)]) }), 290)).rejects.toMatchObject({ code: 'TARGET_PAGE_UNAVAILABLE' })
  })

  it('counts probe requests toward the total page limit', async () => {
    const { repo, finished } = repository()
    let requests = 0
    repo.recordPageRequest = async () => { requests += 1 }
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: fetcher({ 1: page([post('new', 320), post('still-new', 300)]) }),
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 1 })).resolves.toEqual({
      kind: 'partial', pagesStored: 0, reason: 'PAGE_BUDGET_SPENT',
    })
    expect(requests).toBe(1)
    expect(finished).toEqual(['partial:PAGE_BUDGET_SPENT'])
  })

  it('rechecks greeting-session priority after a request delay', async () => {
    const { repo } = repository()
    const sleeps: number[] = []
    const busyAtFetch: boolean[] = []
    let busy = false
    let delayedOnce = false
    const pages = {
      1: page([post('new', 320), post('still-new', 300)]),
      2: page([post('in', 250), post('old', 190)]),
    }
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: {
        read: async (number) => {
          busyAtFetch.push(busy)
          return pages[number as keyof typeof pages] ?? page([], 1)
        },
      },
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min },
      sleep: async (ms) => {
        sleeps.push(ms)
        if (ms === 5_000 && !delayedOnce) {
          delayedOnce = true
          busy = true
        } else if (ms === 1_000) {
          busy = false
        }
      },
      isSessionBusy: () => busy, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toMatchObject({ kind: 'succeeded' })
    expect(sleeps).toContain(1_000)
    expect(busyAtFetch.every((value) => value === false)).toBe(true)
  })

  it('relocates an anchor shifted by multiple pages and reuses the matched candidate', async () => {
    const { repo, persisted } = repositoryWithCheckpoint({ anchorPostId: 'anchor', anchorPostedAtMs: 280, referencePage: 2, stateVersion: 7 })
    const fetched: number[] = []
    const pages = {
      1: page([post('n1', 350), post('n2', 340)]),
      2: page([post('n3', 330), post('n4', 320)]),
      3: page([post('anchor', 280), post('resume-here', 250)]),
      4: page([post('old', 190)]),
    }
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: {
        read: async (number) => {
          fetched.push(number)
          return pages[number as keyof typeof pages] ?? page([], 1)
        },
      },
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run: { ...run, resumeFromCheckpoint: true }, maxPages: 10 })).resolves.toMatchObject({ kind: 'succeeded' })
    // Stable adjacent pages do not overlap, so the conservative continuity
    // rule re-reads page 3 before accepting page 4.
    // Starts at the page the cursor named rather than one before it: posts only
    // ever drift to higher page numbers, so the page before is never the answer.
    expect(fetched).toEqual([2, 3, 4, 3])
    expect(persisted.flatMap((input) => input.page.items.map((item) => item.postId))).toEqual(['resume-here'])
  })

  it('records observation time immediately before the fetch starts', async () => {
    const { repo, persisted } = repository()
    let now = 1_000
    const resultPage = page([post('in', 250), post('old', 190)])
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: {
        read: async () => {
          // Simulate network/parse latency after the scheduled reader sampled
          // its clock. Persistence must retain the earlier instant.
          now += 5_000
          return resultPage
        },
      },
      clock: { now: () => now }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toMatchObject({ kind: 'succeeded' })
    // page 1 is probed once and then fetched for collection. The collection
    // fetch starts at 6000 and completes at 11000.
    expect(persisted[0]?.observedAt).toEqual(new Date(6_000))
  })

  it('skips duplicate tail rows without a rewind read when new posts push the anchor into the next page', async () => {
    const { repo, persisted } = repository()
    const fetched: number[] = []
    const pages = {
      1: page([post('a', 280), post('b', 270)]),
      2: page([post('b', 270), post('c', 260), post('old', 190)]),
    }
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: { read: async (number) => { fetched.push(number); return pages[number as keyof typeof pages] ?? page([], 1) } },
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toEqual({ kind: 'succeeded', pagesStored: 2 })
    expect(fetched).toEqual([1, 1, 2])
    expect(persisted.flatMap((input) => input.page.items.map((item) => item.postId))).toEqual(['a', 'b', 'c'])
  })

  it('detects posts pulled past the page boundary through the rewind read and resumes from the rewound tail', async () => {
    const { repo, persisted } = repository()
    const fetched: number[] = []
    const pageOneBefore = page([post('a', 280), post('b', 270)])
    // One insertion and one deletion leave the total unchanged while moving
    // the boundary. Rewind must still recover c.
    const pageOneAfterDeletion = page([post('b', 270), post('c', 260)], 100, 500)
    const pageTwo = page([post('d', 250), post('old', 190)], 100, 500)
    let pageOneReads = 0
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: {
        read: async (number) => {
          fetched.push(number)
          if (number !== 1) return pageTwo
          pageOneReads += 1
          return pageOneReads <= 2 ? pageOneBefore : pageOneAfterDeletion
        },
      },
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 10 })).resolves.toEqual({ kind: 'succeeded', pagesStored: 3 })
    expect(fetched).toEqual([1, 1, 2, 1, 2, 1])
    expect(persisted.flatMap((input) => input.page.items.map((item) => item.postId))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('fails the run when the continuity anchor disappears and cannot be relocated', async () => {
    const { repo, finished } = repository()
    const pageOneBefore = page([post('a', 280), post('b', 270)])
    const pageOneMoved = page([post('n1', 300), post('n2', 295)], 100, 503)
    const pageTwo = page([post('x', 240), post('old', 190)], 100, 503)
    let pageOneReads = 0
    const orchestrator = createCollectionOrchestrator({
      repository: repo,
      fetcher: {
        read: async (number) => {
          if (number !== 1) return pageTwo
          pageOneReads += 1
          return pageOneReads <= 2 ? pageOneBefore : pageOneMoved
        },
      },
      clock: { now: () => 1_000 }, random: { intInclusive: (min) => min }, sleep: async () => undefined,
      isSessionBusy: () => false, isAbortRequested: () => false,
    })

    await expect(orchestrator.run({ feed, run, maxPages: 20 })).resolves.toEqual({ kind: 'failed', pagesStored: 1, code: 'ANCHOR_RELOCATION_FAILED' })
    expect(finished).toEqual(['failed:ANCHOR_RELOCATION_FAILED'])
  })
})
