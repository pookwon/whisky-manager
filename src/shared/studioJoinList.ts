import { CAFE_MEMBER_LIST } from './cafeMemberFixture.js'
import { kstCalendarOf, MS_PER_DAY } from './kst.js'

const API_ROOT = 'https://apis.cafe.naver.com/cafe-manage/cafe-manage/v1'
const STUDIO_ROOT = `https://studio.cafe.naver.com/@${CAFE_MEMBER_LIST.cafeId}/member/list`

export const STUDIO_JOIN_PER_PAGE = 250

/** The member screen: it sends an unverified operator to the identity check. */
export const STUDIO_MEMBER_PAGE_URL = STUDIO_ROOT

export const STUDIO_IDENTITY_STATUS_URL = `${API_ROOT}/pii-auth/status`

/** One page of the members who joined on these KST days, both ends included. */
export function studioJoinPageUrl(joinedFrom: string, joinedTo: string, page: number): string {
  const url = new URL(`${API_ROOT}/cafes/${CAFE_MEMBER_LIST.cafeId}/members/list`)
  url.searchParams.set('activityStopFilter', 'ALL')
  url.searchParams.set('perPage', String(STUDIO_JOIN_PER_PAGE))
  url.searchParams.set('page', String(page))
  url.searchParams.set('detailSearchType', 'JOIN_DATE')
  url.searchParams.set('startDate', joinedFrom)
  url.searchParams.set('endDate', joinedTo)
  url.searchParams.set('sortType', 'JOIN_DATE')
  url.searchParams.set('sortOrder', 'DESC')
  return url.toString()
}

const JOIN_DAY = /^\d{4}-\d{2}-\d{2}$/

export function isJoinDay(value: unknown): value is string {
  return typeof value === 'string' && JOIN_DAY.test(value)
}

function kstDayText(epochMs: number): string {
  const { year, month, day } = kstCalendarOf(epochMs)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface JoinWindow {
  readonly from: string
  readonly to: string
}

const WINDOW_DAYS = 7

/**
 * The last `days` KST days, today included, in week-long pieces oldest first.
 * The list stops at 5,000 members, so a month is read a week at a time.
 */
export function recentJoinWindows(nowMs: number, days: number): readonly JoinWindow[] {
  const windows: JoinWindow[] = []
  for (let offset = days - 1; offset >= 0; offset -= WINDOW_DAYS) {
    const last = Math.max(offset - WINDOW_DAYS + 1, 0)
    windows.push({ from: kstDayText(nowMs - offset * MS_PER_DAY), to: kstDayText(nowMs - last * MS_PER_DAY) })
  }
  return windows
}

export interface StudioJoinMember {
  readonly memberKey: string
  readonly memberTag: string
  readonly nickname: string
  readonly maskedMemberId: string
  /** The studio's own KST clock text, `2026-11-01T16:47:51.53`, with no zone on it. */
  readonly joinedAt: string
  readonly levelName: string
  readonly visitCount: number
  readonly articleCount: number
  readonly commentCount: number
  readonly activityStopped: boolean
  /** In the order the join form asks them. */
  readonly answers: readonly string[]
}

export interface StudioJoinPage {
  readonly members: readonly StudioJoinMember[]
  readonly totalCount: number
  /** The list stopped counting at its cap, so paging it would lose members. */
  readonly capped: boolean
}

export class StudioResponseError extends Error {}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StudioResponseError(`${path} is not an object`)
  return value as Record<string, unknown>
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string') throw new StudioResponseError(`${key} is not a string`)
  return value
}

function count(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new StudioResponseError(`${key} is not a count`)
  return value
}

function joinAnswers(value: unknown): readonly string[] {
  // Members from before the join form was introduced carry no answers.
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new StudioResponseError('joinAnswers is not a list')
  return value
    .map((entry) => record(entry, 'joinAnswer'))
    .sort((left, right) => count(left, 'itemNo') - count(right, 'itemNo'))
    .map((entry) => text(entry, 'answer'))
}

function member(value: unknown): StudioJoinMember {
  const entry = record(value, 'member')
  return {
    memberKey: text(entry, 'memberKey'),
    memberTag: text(entry, 'memberTag'),
    nickname: text(entry, 'nickname'),
    maskedMemberId: text(entry, 'maskedMemberId'),
    joinedAt: text(entry, 'joinDate'),
    levelName: text(entry, 'memberLevelName'),
    visitCount: count(entry, 'visitCount'),
    articleCount: count(entry, 'articleCount'),
    commentCount: count(entry, 'commentCount'),
    activityStopped: entry.activityStopped === true,
    answers: joinAnswers(entry.joinAnswers),
  }
}

export function parseStudioJoinPage(body: string): StudioJoinPage {
  const page = record(JSON.parse(body), 'page')
  if (!Array.isArray(page.members)) throw new StudioResponseError('members is not a list')
  return {
    members: page.members.map(member),
    totalCount: count(page, 'totalCount'),
    capped: page.totalCountExceeded === true,
  }
}

/** Anything but a plain yes re-asks: the check is the operator's to pass. */
export function parseStudioIdentity(body: string): boolean {
  return record(JSON.parse(body), 'status').status === 'VERIFIED'
}

/**
 * Whether a refused read is the identity check rather than missing rights. A
 * session that outlives its check gets this in the middle of a search.
 */
export function isStudioIdentityRefusal(status: number, body: string): boolean {
  if (status !== 403) return false
  try {
    return typeof record(JSON.parse(body), 'refusal').authMethod === 'string'
  } catch {
    return false
  }
}
