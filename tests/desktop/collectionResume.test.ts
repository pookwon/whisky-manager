import { describe, expect, it } from 'vitest'
import { RESUME_SCAN_PAGE_LIMIT, locateResumePosition } from '../../src/desktop/collectionResume.js'
import type { ScheduledReader } from '../../src/desktop/collectionOrchestrator.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const NOW = Date.UTC(2026, 8, 1)
const PAGE_SIZE = 50

function post(id: string, postedAt: number): CollectedPostMetadata {
  return {
    cafeId: '14538121', postId: id, boardId: '1', boardName: '게시판',
    title: null, prefix: null, authorId: null, authorNickname: null,
    postedAt, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false,
  }
}

/**
 * A feed of posts one minute apart, newest first, paged fifty at a time.
 *
 * `shift` is how many newer posts have arrived since the cursor was written:
 * that is exactly what pushes an old post to a higher page number, and it is
 * the thing every resume has to survive.
 */
function feed(options: { shift?: number; deleted?: readonly string[]; pageCount?: number } = {}) {
  const shift = options.shift ?? 0
  const deleted = new Set(options.deleted ?? [])
  const pageCount = options.pageCount ?? 400
  const total = pageCount * PAGE_SIZE
  const requested: number[] = []

  // Post n was written n minutes before NOW; the newest carries the highest id.
  const all: CollectedPostMetadata[] = []
  for (let index = 0; index < total; index += 1) {
    const id = String(1_000_000 + shift - index)
    if (deleted.has(id)) continue
    all.push(post(id, NOW - (index - shift) * MINUTE))
  }

  const reader: ScheduledReader = {
    probe: (page) => read(page),
    collect: (page) => read(page),
    observedAt: () => new Date(NOW),
    reads: 0,
  }

  function read(page: number): Promise<CollectedArticlePage> {
    requested.push(page)
    const lastNavigationPageNumber = Math.ceil(page / 10) * 10
    // Past the end the cafe silently answers with the newest page instead.
    const effective = page > pageCount ? 1 : page
    const items = all.slice((effective - 1) * PAGE_SIZE, effective * PAGE_SIZE)
    return Promise.resolve({
      items,
      pageInfo: {
        lastNavigationPageNumber: page > pageCount ? 10 : lastNavigationPageNumber,
        visibleNextButton: true,
        totalArticleCount: all.length,
      },
      pageIdentity: `page:${effective}`,
    })
  }

  return { reader, requested }
}

/** The cursor as it was written when page `page` was committed. */
function cursor(overrides: Partial<Parameters<typeof locateResumePosition>[1]> = {}) {
  const page = 120
  const anchorIndex = page * PAGE_SIZE - 1
  return {
    anchorPostId: String(1_000_000 - anchorIndex),
    anchorPostedAtMs: NOW - anchorIndex * MINUTE,
    referencePage: page,
    cursorUpdatedAtMs: NOW - 2 * HOUR,
    ...overrides,
  }
}

const targetStartMs = NOW - 400 * PAGE_SIZE * MINUTE

/** Where the anchor sits once `shift` newer posts have pushed it back. */
function pageAfterShift(shift: number): number {
  const anchorIndex = 120 * PAGE_SIZE - 1
  return Math.floor((anchorIndex + shift) / PAGE_SIZE) + 1
}

describe('locating where a run left off', () => {
  it('finds the anchor on its own page when nothing has moved', async () => {
    const f = feed()
    const found = await locateResumePosition(f.reader, cursor(), NOW, targetStartMs)

    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    expect(found.page).toBe(120)
    // The anchor is the last post of its page, so the walk carries on with the next page.
    expect(found.offset).toBe(PAGE_SIZE)
    expect(f.requested).toEqual([120])
  })

  it('finds it on the next page after a block of rest', async () => {
    // Two hours at the daytime rate is about one page of drift.
    const f = feed({ shift: 53 })
    const found = await locateResumePosition(f.reader, cursor(), NOW, targetStartMs)

    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    expect(found.page).toBe(pageAfterShift(53))
    expect(f.requested).toEqual([120, 121, 122])
  })

  it('walks a handful of pages after a night, without jumping', async () => {
    // Twelve hours at the night rate is about four pages.
    const f = feed({ shift: 4 * PAGE_SIZE + 10 })
    const found = await locateResumePosition(
      f.reader,
      cursor({ cursorUpdatedAtMs: NOW - 12 * HOUR }),
      NOW,
      targetStartMs,
    )

    expect(found.kind).toBe('found')
    // One page at a time from where the cursor was written, and no further.
    expect(f.requested).toEqual([120, 121, 122, 123, 124, 125])
    expect(f.requested.at(-1)).toBe(pageAfterShift(4 * PAGE_SIZE + 10))
  })

  it('jumps by navigation groups once the cursor is a day old', async () => {
    // A week away: about sixty pages of drift, which page-by-page would spend
    // sixty requests and most of a block's budget.
    const f = feed({ shift: 60 * PAGE_SIZE + 20 })
    const found = await locateResumePosition(
      f.reader,
      cursor({ cursorUpdatedAtMs: NOW - 7 * DAY }),
      NOW,
      targetStartMs,
    )

    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    expect(found.page).toBe(pageAfterShift(60 * PAGE_SIZE + 20))
    expect(f.requested.length).toBeLessThan(15)
    // Every jump lands on the first page of a navigation group, which is what
    // the cafe's own "next" button does.
    expect(f.requested.slice(1, 4)).toEqual([121, 131, 141])
  })

  it('gives up scanning and jumps when the feed moved further than a day usually does', async () => {
    // Under a day by the clock, but the cafe had a burst: the scan must not
    // keep walking until it has eaten the block's budget.
    const f = feed({ shift: 40 * PAGE_SIZE })
    const found = await locateResumePosition(f.reader, cursor(), NOW, targetStartMs)

    expect(found.kind).toBe('found')
    expect(f.requested.length).toBeLessThan(RESUME_SCAN_PAGE_LIMIT + 12)
  })

  it('resumes from the anchor\'s own time when the anchor post was deleted', async () => {
    const gone = cursor()
    const f = feed({ shift: 53, deleted: [gone.anchorPostId] })
    const found = await locateResumePosition(f.reader, gone, NOW, targetStartMs)

    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    // Everything from the first post older than the anchor onward is unread.
    const first = found.candidate.items[found.offset]
    expect(first).toBeDefined()
    expect(first!.postedAt).toBeLessThan(gone.anchorPostedAtMs)
    const previous = found.candidate.items[found.offset - 1]
    if (previous !== undefined) expect(previous.postedAt).toBeGreaterThan(gone.anchorPostedAtMs)
  })

  it('refuses a cursor whose page is past the end of the feed', async () => {
    // The cafe answers a too-large page with its newest one, which would read
    // as "the anchor is not here" forever.
    const f = feed({ pageCount: 60 })
    const found = await locateResumePosition(
      f.reader,
      cursor({ referencePage: 400, cursorUpdatedAtMs: NOW - 7 * DAY }),
      NOW,
      targetStartMs,
    )

    expect(found.kind).toBe('unusable')
  })

  it('reports the period finished when the search runs past its start', async () => {
    // Everything older than the anchor is outside the period, so there is
    // nothing left to walk.
    const f = feed({ shift: 53 })
    const found = await locateResumePosition(
      f.reader,
      cursor(),
      NOW,
      // The period starts newer than the anchor: the walk is already done.
      NOW - 100 * MINUTE,
    )

    expect(found.kind).toBe('complete')
  })

  it('is not fooled by posts an earlier job stored further back', async () => {
    // The decision is made on the cursor's own time, so what else happens to be
    // in the database cannot move the boundary.
    const f = feed({ shift: 53 })
    const found = await locateResumePosition(f.reader, cursor(), NOW, targetStartMs)

    expect(found.kind).toBe('found')
    if (found.kind !== 'found') return
    const resumedAt = found.candidate.items[found.offset]
    expect(resumedAt).toBeDefined()
    expect(resumedAt!.postedAt).toBeLessThan(cursor().anchorPostedAtMs)
  })
})
