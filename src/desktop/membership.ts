import { kstDayOf, kstDayToJoinDate } from '../shared/kst.js'
import { MEMBER_PAGE_SIZE } from '../shared/members.js'
import { TIMEOUTS, type RawCandidate } from '../shared/protocol.js'
import type { MembersRepo } from './db/membersRepo.js'
import type { ExtensionTransport } from './ws/server.js'

export type AuthorMembership = { kind: 'JOINED'; joinDate: string } | { kind: 'NOT_TRACKED' }

/**
 * Log a warning when paging exceeds this count. This is not a hard stop — the
 * loop continues until the data itself ends (an out-of-window date or an empty
 * page). A warning makes abnormally long fetches visible without stopping them,
 * which would hide a broken stop condition.
 */
const PAGES_WARNING_THRESHOLD = 50

export interface MembershipDeps {
  readonly transport: ExtensionTransport
  readonly repo: MembersRepo
  readonly cafeId: string
  readonly windowDays: number
  readonly nowMs: number
  readonly newRequestId: () => string
}

/**
 * `'DEFER'` means the answer is unknown this session, not that the author is
 * old. The orchestrator holds such a post and leaves the watermark where it is.
 */
export type MembershipResolver = (raw: RawCandidate) => AuthorMembership | 'DEFER'

async function fetchPage(deps: MembershipDeps, page: number) {
  try {
    const reply = await deps.transport.request(
      {
        type: 'FETCH_MEMBERS',
        requestId: deps.newRequestId(),
        cafeId: deps.cafeId,
        page,
        perPage: MEMBER_PAGE_SIZE,
      },
      TIMEOUTS.fetchMembersMs,
    )
    return reply.type === 'MEMBERS' ? reply.members : null
  } catch {
    return null
  }
}

/**
 * Fills the table forward from the newest joins. When the table is empty,
 * reads back to the window floor to ensure the table covers the full judgement
 * window. When the table already has data, stops as soon as a page holds
 * somebody already stored.
 *
 * The loop terminates when the data ends: an out-of-window join date is found,
 * an empty page is reached, or an already-known member is encountered (on
 * non-first-run). Logs a warning past 50 pages to make broken stop conditions
 * visible.
 */
async function refresh(deps: MembershipDeps): Promise<boolean> {
  const firstRun = deps.repo.isEmpty(deps.cafeId)
  const windowFloorDay = kstDayOf(deps.nowMs) - deps.windowDays
  const windowFloorDate = kstDayToJoinDate(windowFloorDay)

  for (let page = 1; ; page += 1) {
    // Once, not per page: a broken stop condition would otherwise bury the
    // signal under hundreds of identical lines.
    if (page === PAGES_WARNING_THRESHOLD + 1) {
      console.warn(`Member list refresh exceeded ${PAGES_WARNING_THRESHOLD} pages`)
    }

    const members = await fetchPage(deps, page)
    if (members === null) return false
    if (members.length === 0) return true

    // Checked before storing, or every member would look already known.
    const reachedKnown = members.some(
      (member) => deps.repo.joinDateOf(deps.cafeId, member.memberKey) !== null,
    )
    deps.repo.upsertMany(deps.cafeId, members)

    if (!firstRun && reachedKnown) return true

    // On the first run, continue until reaching the window floor. If even the
    // oldest member on this page is inside the window, keep going.
    if (firstRun) {
      const oldestJoinDate = members[members.length - 1]!.joinDate
      if (oldestJoinDate < windowFloorDate) return true
    }
  }
}

export async function createMembershipResolver(deps: MembershipDeps): Promise<MembershipResolver> {
  const fresh = await refresh(deps)

  if (fresh) {
    // One day beyond the window: the backlog brake lets yesterday's posts
    // through, and judging one needs the people who joined a day earlier still.
    deps.repo.prune(deps.cafeId, kstDayToJoinDate(kstDayOf(deps.nowMs) - (deps.windowDays + 1)))
  }

  return (raw) => {
    if (raw.authorId !== null) {
      const joinDate = deps.repo.joinDateOf(deps.cafeId, raw.authorId)
      if (joinDate !== null) return { kind: 'JOINED', joinDate }
    }
    // The member list is the only basis for judgement. If the table could not be
    // read, defer to avoid a silent wrong verdict.
    return fresh ? { kind: 'NOT_TRACKED' } : 'DEFER'
  }
}
