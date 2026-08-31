import type { CollectedArticlePage } from '../shared/cafeArticleList.js'
import type { ScheduledReader } from './collectionOrchestrator.js'

/**
 * Finding where a run left off, days or minutes later.
 *
 * The feed is reverse-chronological and new posts arrive continuously, so a
 * post that sat on page 120 yesterday sits further back today — about eight
 * pages a day at the measured rate. The stored page number is therefore a
 * starting point, never an address.
 */

export interface ResumeCursor {
  readonly anchorPostId: string
  readonly anchorPostedAtMs: number
  readonly referencePage: number
  /** When the cursor last moved; how stale it is decides how hard to look. */
  readonly cursorUpdatedAtMs: number
}

export type ResumePosition =
  /** `offset` is where the walk carries on: the first item not yet collected. */
  | { readonly kind: 'found'; readonly page: number; readonly offset: number; readonly candidate: CollectedArticlePage }
  /** The period's start is newer than the cursor; there is nothing left to walk. */
  | { readonly kind: 'complete' }
  /** The cursor cannot be trusted, so the caller locates the period afresh. */
  | { readonly kind: 'unusable' }

const DAY_MS = 86_400_000

/**
 * Beyond this the cursor is stale enough that jumping is cheaper than walking.
 * Set at a day rather than at the arithmetic break-even of about fourteen
 * hours: page-by-page is the path that already ran, jumping is the new one, and
 * every gap the normal rhythm produces — two hours between blocks, twelve
 * overnight — stays on the older path.
 */
export const RESUME_SCAN_MAX_AGE_MS = DAY_MS

/**
 * How far the page-by-page walk goes before handing over to the jumps. A day of
 * ordinary drift is about eight pages; twenty leaves room for a burst without
 * letting the search eat a block's page budget.
 */
export const RESUME_SCAN_PAGE_LIMIT = 20

/** Guards against a feed that never satisfies the jump's stop condition. */
const RESUME_JUMP_LIMIT = 60

function newest(page: CollectedArticlePage): number {
  return page.items[0]?.postedAt ?? Number.NEGATIVE_INFINITY
}

function oldest(page: CollectedArticlePage): number {
  return page.items.at(-1)?.postedAt ?? Number.POSITIVE_INFINITY
}

/** A page the cafe answered from its newest instead of the one asked for. */
function silentlyFellBack(page: CollectedArticlePage, requested: number): boolean {
  return requested > page.pageInfo.lastNavigationPageNumber
}

/**
 * Where in this page the walk carries on, or null when the anchor's place is
 * not on it.
 *
 * The anchor post itself is preferred; when it has been deleted, its recorded
 * time still says where it sat, and the first post older than that time is the
 * first one this job has not collected.
 */
function positionWithin(page: CollectedArticlePage, cursor: ResumeCursor): number | null {
  const byId = page.items.findIndex((item) => item.postId === cursor.anchorPostId)
  if (byId >= 0) return byId + 1
  if (page.items.length === 0) return null
  if (newest(page) < cursor.anchorPostedAtMs) return null
  if (oldest(page) > cursor.anchorPostedAtMs) return null
  const byTime = page.items.findIndex((item) => item.postedAt < cursor.anchorPostedAtMs)
  return byTime < 0 ? page.items.length : byTime
}

/**
 * Reads one page and says which side of the anchor it falls on. Deliberately
 * decided on the cursor's own time rather than on which posts are already
 * stored: a post being in the database says nothing about whether *this* job
 * collected it, and an earlier job that reached further back would make every
 * page past the boundary look collected.
 */
type Side = 'before' | 'at' | 'after'

function sideOf(page: CollectedArticlePage, cursor: ResumeCursor): Side {
  if (oldest(page) > cursor.anchorPostedAtMs) return 'before'
  if (newest(page) < cursor.anchorPostedAtMs) return 'after'
  return 'at'
}

export async function locateResumePosition(
  reader: ScheduledReader,
  cursor: ResumeCursor,
  nowMs: number,
  targetStartMs: number,
): Promise<ResumePosition> {
  // Everything older than the anchor is outside the period, so the job has
  // already walked as far as it was asked to.
  if (cursor.anchorPostedAtMs <= targetStartMs) return { kind: 'complete' }

  const stale = nowMs - cursor.cursorUpdatedAtMs >= RESUME_SCAN_MAX_AGE_MS
  const first = Math.max(1, cursor.referencePage)

  if (!stale) {
    const scanned = await scan(reader, cursor, first)
    if (scanned !== null) return scanned
  }

  return await jump(reader, cursor, first, targetStartMs)
}

/**
 * Walks forward a page at a time from where the cursor was written. Returns
 * null when the anchor is not within reach, which hands the search to the
 * jumps rather than reporting a position it did not find.
 */
async function scan(
  reader: ScheduledReader,
  cursor: ResumeCursor,
  from: number,
): Promise<ResumePosition | null> {
  for (let page = from; page < from + RESUME_SCAN_PAGE_LIMIT; page += 1) {
    const candidate = await reader.collect(page)
    if (silentlyFellBack(candidate, page)) return { kind: 'unusable' }

    const offset = positionWithin(candidate, cursor)
    if (offset !== null) return { kind: 'found', page, offset, candidate }

    // Only forward. Deletions can pull an old post toward lower page numbers,
    // but new arrivals outnumber them by far, so the net movement is backward
    // — and a page already older than the anchor means the anchor's own page
    // was skipped, which the jumps handle by bracketing rather than guessing.
    if (sideOf(candidate, cursor) === 'after') return null
  }
  return null
}

/**
 * Jumps by whole navigation groups, then brackets the anchor between the last
 * page before it and the first page after it.
 *
 * The group size is read from each response rather than assumed: the cafe says
 * where its navigation group ends, so "the next group" stays right even if that
 * changes.
 */
async function jump(
  reader: ScheduledReader,
  cursor: ResumeCursor,
  from: number,
  targetStartMs: number,
): Promise<ResumePosition> {
  let low = from
  let high: number | null = null

  for (let jumps = 0; jumps < RESUME_JUMP_LIMIT; jumps += 1) {
    const candidate = await reader.collect(low)
    if (silentlyFellBack(candidate, low)) return { kind: 'unusable' }

    const offset = positionWithin(candidate, cursor)
    if (offset !== null) return { kind: 'found', page: low, offset, candidate }

    if (sideOf(candidate, cursor) === 'after') {
      high = low
      break
    }
    // Nothing older than the period remains to be walked.
    if (oldest(candidate) < targetStartMs) return { kind: 'complete' }

    const next = candidate.pageInfo.lastNavigationPageNumber + 1
    if (next <= low) return { kind: 'unusable' }
    low = next
  }

  if (high === null) return { kind: 'unusable' }

  // The anchor sits between the last page that was still newer than it and the
  // first that was older; the group is at most ten pages wide.
  let lower = Math.max(from, high - 10)
  let upper = high
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    const candidate = await reader.collect(middle)
    if (silentlyFellBack(candidate, middle)) return { kind: 'unusable' }

    const offset = positionWithin(candidate, cursor)
    if (offset !== null) return { kind: 'found', page: middle, offset, candidate }

    if (sideOf(candidate, cursor) === 'after') upper = middle
    else lower = middle + 1
  }

  // The anchor's page fell between two reads, which only deletions can do. The
  // first page older than it is where the uncollected posts start.
  const candidate = await reader.collect(upper)
  if (silentlyFellBack(candidate, upper)) return { kind: 'unusable' }
  return { kind: 'found', page: upper, offset: 0, candidate }
}
