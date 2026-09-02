import type { CollectedMemberPage } from '../shared/cafeMemberList.js'

/**
 * Finding where the member walk left off. The list is join-date descending and
 * about a hundred new members arrive a day, so a page that held the anchor
 * yesterday holds it about one page further back today. The stored page number
 * is a starting point, never an address. Join dates are ISO `YYYY-MM-DD`, so a
 * plain string comparison is a date comparison.
 */
export interface MemberResumeCursor {
  readonly anchorMemberKey: string
  readonly anchorJoinDate: string
  readonly referencePage: number
}

export type MemberResumePosition =
  | { readonly kind: 'found'; readonly page: number; readonly offset: number; readonly candidate: CollectedMemberPage }
  | { readonly kind: 'unusable' }

export interface MemberScheduledReader {
  collect(page: number): Promise<CollectedMemberPage>
  observedAt(page: CollectedMemberPage): Date
  readonly reads: number
}

/** How far the ±1 relocation walks before giving up. A few days' drift is a few pages. */
export const MEMBER_RESUME_SCAN_PAGE_LIMIT = 20

function newestJoinDate(page: CollectedMemberPage): string | null {
  return page.items[0]?.joinDate ?? null
}
function oldestJoinDate(page: CollectedMemberPage): string | null {
  return page.items.at(-1)?.joinDate ?? null
}

/**
 * Where on this page the walk carries on, or null when the anchor's place is not
 * here. The anchor member is preferred; if it has seceded, its join date still
 * says where it sat, and the walk resumes after the last member of that date.
 */
function positionWithin(page: CollectedMemberPage, cursor: MemberResumeCursor): number | null {
  const byKey = page.items.findIndex((item) => item.memberKey === cursor.anchorMemberKey)
  if (byKey >= 0) return byKey + 1
  const newest = newestJoinDate(page)
  const oldest = oldestJoinDate(page)
  if (newest === null || oldest === null) return null
  // The anchor's join date has to fall within the page for a seceded resume.
  if (cursor.anchorJoinDate > newest || cursor.anchorJoinDate < oldest) return null
  // Resume after the last member whose join date equals the anchor's — the next
  // member is either an older join date or one this job has not collected.
  let lastSameDate = -1
  for (let index = 0; index < page.items.length; index += 1) {
    if (page.items[index]!.joinDate === cursor.anchorJoinDate) lastSameDate = index
  }
  return lastSameDate < 0 ? null : lastSameDate + 1
}

type Side = 'newer' | 'at' | 'older'
function sideOf(page: CollectedMemberPage, cursor: MemberResumeCursor): Side {
  const newest = newestJoinDate(page)
  const oldest = oldestJoinDate(page)
  if (newest === null || oldest === null) return 'at'
  if (oldest > cursor.anchorJoinDate) return 'newer'
  if (newest < cursor.anchorJoinDate) return 'older'
  return 'at'
}

/**
 * Relocates the anchor by stepping one page at a time in the direction the join
 * date range indicates: a page entirely newer than the anchor is above it (walk
 * forward, higher page numbers), a page entirely older is below it (walk back).
 */
export async function locateMemberResumePosition(
  reader: MemberScheduledReader,
  cursor: MemberResumeCursor,
): Promise<MemberResumePosition> {
  const start = Math.max(1, cursor.referencePage)
  const first = await reader.collect(start)
  const here = positionWithin(first, cursor)
  if (here !== null) return { kind: 'found', page: start, offset: here, candidate: first }

  const direction = sideOf(first, cursor) === 'newer' ? 1 : -1
  let page = start
  for (let step = 0; step < MEMBER_RESUME_SCAN_PAGE_LIMIT; step += 1) {
    const next = page + direction
    if (next < 1) return { kind: 'unusable' }
    page = next
    const candidate = await reader.collect(page)
    if (candidate.items.length === 0) return { kind: 'unusable' }
    const offset = positionWithin(candidate, cursor)
    if (offset !== null) return { kind: 'found', page, offset, candidate }
    // Overshot: the direction has flipped, so the anchor's page fell between two
    // reads (only secessions can do that). Resume from this page's start.
    if ((direction === 1 && sideOf(candidate, cursor) === 'older') || (direction === -1 && sideOf(candidate, cursor) === 'newer')) {
      return { kind: 'found', page, offset: 0, candidate }
    }
  }
  return { kind: 'unusable' }
}
