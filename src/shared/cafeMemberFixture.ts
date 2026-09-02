/**
 * The one read-only management endpoint Phase 0 is allowed to capture for the
 * member list. Keeping the URL and its fixed query here (rather than accepting a
 * free-form URL from the capture CLI) makes it impossible for that CLI to become
 * a general-purpose browser-session dump. Sanitization is reused from the
 * article fixture module: it already replaces memberKey and nickname with
 * deterministic, length-preserving pseudonyms.
 */
export const CAFE_MEMBER_LIST = {
  cafeId: '14538121',
  perPage: 100,
  searchType: 0,
  memberLevel: 0,
  sortType: 0,
  sortOrder: 0,
} as const

const API_ORIGIN = 'https://cafe.naver.com'
const MEMBER_LIST_PATH = '/ManageMemberListViewAjax.nhn'

export function cafeMemberListUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`page must be a positive safe integer: ${page}`)
  }
  const url = new URL(`${API_ORIGIN}${MEMBER_LIST_PATH}`)
  url.searchParams.set('search.clubid', CAFE_MEMBER_LIST.cafeId)
  url.searchParams.set('search.searchType', String(CAFE_MEMBER_LIST.searchType))
  url.searchParams.set('search.memberLevel', String(CAFE_MEMBER_LIST.memberLevel))
  url.searchParams.set('search.perPage', String(CAFE_MEMBER_LIST.perPage))
  url.searchParams.set('search.page', String(page))
  url.searchParams.set('search.sortType', String(CAFE_MEMBER_LIST.sortType))
  url.searchParams.set('search.sortOrder', String(CAFE_MEMBER_LIST.sortOrder))
  url.searchParams.set('search.paginationCached', 'false')
  url.searchParams.set('search.totalCountCached', '0')
  return url.toString()
}

/** True for this endpoint regardless of query parameters. */
export function isCafeMemberListEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.origin === API_ORIGIN && url.pathname === MEMBER_LIST_PATH
}

/** True only for the exact Phase 0 member-list request, including its fixed query. */
export function isCafeMemberListTarget(value: string): boolean {
  if (!isCafeMemberListEndpoint(value)) return false
  const url = new URL(value)

  const expected = new Map<string, string>([
    ['search.clubid', CAFE_MEMBER_LIST.cafeId],
    ['search.searchType', String(CAFE_MEMBER_LIST.searchType)],
    ['search.memberLevel', String(CAFE_MEMBER_LIST.memberLevel)],
    ['search.perPage', String(CAFE_MEMBER_LIST.perPage)],
    ['search.sortType', String(CAFE_MEMBER_LIST.sortType)],
    ['search.sortOrder', String(CAFE_MEMBER_LIST.sortOrder)],
    ['search.paginationCached', 'false'],
    ['search.totalCountCached', '0'],
  ])
  if (url.searchParams.size !== expected.size + 1) return false

  const page = url.searchParams.get('search.page')
  if (page === null || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) return false

  for (const [key, expectedValue] of expected) {
    if (url.searchParams.get(key) !== expectedValue) return false
  }
  return true
}

/**
 * An allowlist sanitizer for member-list fixtures. Unlike the article sanitizer
 * (which is a denylist tuned to a different endpoint), this one keeps only the
 * fields the parser actually reads and replaces everything else with a shape
 * marker that preserves the key name, runtime type, and value size while
 * carrying no personal content.
 *
 * The two fields the parser consumes as identity — memberKey and nickname — are
 * pseudonymized with the same deterministic, length-preserving scheme the article
 * fixture uses, so equality relationships across pages are preserved.
 */

type JsonPrimitive = null | boolean | number | string
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** Fields the parser reads directly; all others are shape-only. */
const MEMBER_ALLOWLIST = new Set(['memberKey', 'nickname', 'joinDate', 'memberLevelName', 'manager', 'staff'])

function fixtureDigest(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * prime) & mask
  }
  return hash.toString(36).padStart(13, '0')
}

function sameLengthToken(label: string, value: string): string {
  if (value.length === 0) return ''
  const source = `${label}-${fixtureDigest(`${label}\u0000${value}`)}`
  return source.repeat(Math.ceil(value.length / source.length)).slice(0, value.length)
}

function shapeMarker(value: JsonValue): string {
  if (value === null) return '<null>'
  if (typeof value === 'boolean') return '<bool>'
  if (typeof value === 'number') return '<number>'
  if (typeof value === 'string') return `<string:${value.length}>`
  if (Array.isArray(value)) return `<array:${value.length}>`
  return '<object>'
}

/**
 * Sanitizes one JSON value, aware of whether it sits inside the `members`
 * array. Inside that context every non-allowlisted primitive (including
 * booleans and numbers) becomes a shape marker, because any value there could
 * carry identity information we do not know about yet. Outside that context —
 * in the response envelope — booleans and numbers pass through unchanged,
 * because no identifier in this response is a boolean or a number, and
 * envelope flags such as `isSuccess` and counts such as `totalCount` are the
 * whole reason the capture tool exists.
 */
function sanitizeMemberValue(value: JsonValue, key: string | null, insideMembers: boolean): JsonValue {
  if (key === 'memberKey') {
    return typeof value === 'string' ? sameLengthToken('memberkey', value) : shapeMarker(value)
  }
  if (key === 'nickname') {
    if (value === null) return null
    return typeof value === 'string' ? sameLengthToken('nickname', value) : shapeMarker(value)
  }
  if (key !== null && MEMBER_ALLOWLIST.has(key)) {
    // Pass allowed non-identity primitives through unchanged.
    return value
  }
  if (Array.isArray(value)) {
    // The `members` key marks the boundary: everything inside is member data.
    const nextInsideMembers = insideMembers || key === 'members'
    return value.map((item) => sanitizeMemberValue(item, null, nextInsideMembers))
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: { [key: string]: JsonValue } = {}
    for (const [k, child] of Object.entries(value)) {
      sanitized[k] = sanitizeMemberValue(child, k, insideMembers)
    }
    return sanitized
  }
  // Primitive outside the allowlist.
  // Inside members: always shape-mark (any value could be PII we have not seen).
  // Outside members: booleans and numbers carry no identity; pass them through
  // so envelope fields like isSuccess and totalCount survive in the fixture.
  if (insideMembers) return shapeMarker(value)
  if (typeof value === 'boolean' || typeof value === 'number') return value
  return shapeMarker(value)
}

/**
 * Produces a member-list fixture safe for the test fixtures directory.
 * Only the fields the parser reads are kept verbatim; identity fields are
 * pseudonymized; everything else is replaced with a shape marker.
 */
export function sanitizeCafeMemberFixture(value: unknown): JsonValue {
  return sanitizeMemberValue(value as JsonValue, null, false)
}

/** Parse raw response text in memory and serialize only the sanitized fixture. */
export function sanitizeCafeMemberFixtureText(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('member list response was not valid JSON')
  }
  return `${JSON.stringify(sanitizeCafeMemberFixture(parsed), null, 2)}\n`
}
