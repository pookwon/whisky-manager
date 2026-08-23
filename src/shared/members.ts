import { joinDateToKstDay } from './kst.js'

/**
 * The cafe's member management list, which is the only place that reports when
 * somebody joined. Endpoint and parameters were read out of the management
 * page's own script and called against a logged-in session — see the design
 * spec, section 3.3. Nothing here fetches; the extension supplies the session.
 */
const ORIGIN = 'https://cafe.naver.com'

/** One page covers roughly a day of joins at this cafe's rate. */
export const MEMBER_PAGE_SIZE = 100

export interface RawMember {
  readonly memberKey: string
  readonly joinDate: string
}

export function memberListUrl(cafeId: string, page: number, perPage: number): string {
  return (
    `${ORIGIN}/ManageMemberListViewAjax.nhn?search.clubid=${cafeId}` +
    `&search.searchType=0&search.memberLevel=0` +
    `&search.perPage=${perPage}&search.page=${page}` +
    // sortType 0 with sortOrder 0 is join date, newest first.
    `&search.sortType=0&search.sortOrder=0` +
    `&search.paginationCached=false&search.totalCountCached=0`
  )
}

interface RawRecord {
  readonly memberKey?: unknown
  readonly joinDate?: unknown
}

/**
 * `null` means the list could not be read, which is not the same as the cafe
 * having no members on this page. An empty array is an answer; a failed read is
 * not, and the caller must not treat one as the other.
 */
export function parseMemberList(body: string): RawMember[] | null {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null) return null

  const envelope = payload as { isSuccess?: unknown; result?: { members?: unknown } }
  // A real boolean here, unlike the memo comment endpoint's string "true".
  if (envelope.isSuccess !== true) return null

  const list = envelope.result?.members
  if (!Array.isArray(list)) return null

  const members: RawMember[] = []
  for (const record of list as RawRecord[]) {
    const { memberKey, joinDate } = record
    if (typeof memberKey !== 'string' || memberKey === '') continue
    if (typeof joinDate !== 'string' || joinDateToKstDay(joinDate) === null) continue
    members.push({ memberKey, joinDate })
  }
  return members
}
