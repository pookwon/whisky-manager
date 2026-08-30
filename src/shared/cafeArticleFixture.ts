/**
 * The one read-only endpoint Phase 0 is allowed to capture.  Keeping the URL
 * here (instead of accepting a free-form URL from the capture CLI) makes it
 * impossible for that CLI to become a general-purpose browser-session dump.
 */
export const CAFE_ARTICLE_LIST = {
  cafeId: '14538121',
  menuId: '0',
  pageSize: 50,
  sortBy: 'TIME',
  viewType: 'L',
} as const

const API_ORIGIN = 'https://apis.naver.com'
const ARTICLE_LIST_PATH = `/cafe-web/cafe-boardlist-api/v1/cafes/${CAFE_ARTICLE_LIST.cafeId}/menus/${CAFE_ARTICLE_LIST.menuId}/articles`

export function cafeArticleListUrl(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`page must be a positive safe integer: ${page}`)
  }

  const url = new URL(`${API_ORIGIN}${ARTICLE_LIST_PATH}`)
  url.searchParams.set('page', String(page))
  url.searchParams.set('pageSize', String(CAFE_ARTICLE_LIST.pageSize))
  url.searchParams.set('sortBy', CAFE_ARTICLE_LIST.sortBy)
  url.searchParams.set('viewType', CAFE_ARTICLE_LIST.viewType)
  return url.toString()
}

/** True for this endpoint regardless of query parameters. */
export function isCafeArticleListEndpoint(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  return url.origin === API_ORIGIN && url.pathname === ARTICLE_LIST_PATH
}

/** True only for the exact Phase 0 list request, including its fixed query. */
export function isCafeArticleListTarget(value: string): boolean {
  if (!isCafeArticleListEndpoint(value)) return false
  const url = new URL(value)

  const expected = new Map<string, string>([
    ['pageSize', String(CAFE_ARTICLE_LIST.pageSize)],
    ['sortBy', CAFE_ARTICLE_LIST.sortBy],
    ['viewType', CAFE_ARTICLE_LIST.viewType],
  ])
  if (url.searchParams.size !== expected.size + 1) return false

  const page = url.searchParams.get('page')
  if (page === null || !/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) return false

  for (const [key, expectedValue] of expected) {
    if (url.searchParams.get(key) !== expectedValue) return false
  }
  return true
}

type JsonPrimitive = null | boolean | number | string
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

const SECRET_KEYS = new Set([
  'authorization',
  'auth',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'session',
  'sessionid',
  'sessionkey',
  'password',
  'credential',
  'csrf',
  'csrftoken',
  'xsrf',
  'xsrftoken',
])

const IDENTIFIER_KEYS = new Set([
  'account',
  'accountid',
  'authorid',
  'authornickname',
  'email',
  'loginid',
  'memberid',
  'memberkey',
  'mobile',
  'nickname',
  'phone',
  'profileid',
  'userid',
  'userno',
  'writerid',
  'writernickname',
])

const POST_TEXT_KEYS = new Set(['body', 'content', 'contents', 'description', 'subject', 'summary', 'title'])
const PERSONAL_CONTEXT = /(?:account|author|member|profile|user|writer)/

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/**
 * A compact deterministic digest, used only to retain equality relationships
 * in a fixture. It is not a credential or a reversible encoding of the input.
 */
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

function identifierFamily(key: string): string {
  for (const suffix of [
    'memberkey',
    'memberid',
    'accountid',
    'authorid',
    'authornickname',
    'writernickname',
    'writerid',
    'profileid',
    'userid',
    'userno',
    'loginid',
    'nickname',
    'account',
    'email',
    'mobile',
    'phone',
  ]) {
    if (key.endsWith(suffix)) return suffix
  }
  return key
}

function anonymizeIdentifier(value: JsonPrimitive, key: string): JsonPrimitive {
  const family = identifierFamily(key)
  if (typeof value === 'string') return sameLengthToken(family, value)
  if (typeof value === 'number') {
    const digest = fixtureDigest(`${family}\u0000${value}`)
    return Number.parseInt(digest.slice(-7), 36) % 90_000_000 + 10_000_000
  }
  return value
}

function redactedText(value: string, key: string): string {
  return sameLengthToken(`${key}-text`, value)
}

function redactedUrl(value: string, key: string): string {
  return `https://fixture.invalid/${key}/${fixtureDigest(`${key}\u0000${value}`)}`
}

function looksLikeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key) || key.endsWith('token') || key.endsWith('cookie')
}

function isPersonalIdentifier(key: string, path: readonly string[]): boolean {
  if (
    IDENTIFIER_KEYS.has(key) ||
    /(?:accountid|authorid|authornickname|email|loginid|memberid|memberkey|mobile|nickname|phone|profileid|userid|userno|writerid|writernickname)$/.test(
      key,
    )
  ) {
    return true
  }
  return (key === 'id' || key === 'name') && path.some((part) => PERSONAL_CONTEXT.test(part))
}

function isProfileField(key: string): boolean {
  return key.includes('profile') || key.includes('avatar') || key.includes('thumbnail') || key.includes('imageurl')
}

function sanitizeValue(value: JsonValue, path: readonly string[], currentKey: string | null): JsonValue {
  if (value === null || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    return currentKey !== null && isPersonalIdentifier(currentKey, path) ? anonymizeIdentifier(value, currentKey) : value
  }

  if (typeof value === 'string') {
    if (looksLikeHttpUrl(value) || (currentKey !== null && isProfileField(currentKey))) {
      return redactedUrl(value, currentKey ?? 'url')
    }
    if (currentKey !== null && isPersonalIdentifier(currentKey, path)) {
      return anonymizeIdentifier(value, currentKey)
    }
    if (currentKey !== null && POST_TEXT_KEYS.has(currentKey)) return redactedText(value, currentKey)
    return value
  }

  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, path, currentKey))

  const sanitized: { [key: string]: JsonValue } = {}
  for (const [key, child] of Object.entries(value)) {
    const keyName = normalizedKey(key)
    if (isSecretKey(keyName)) continue
    sanitized[key] = sanitizeValue(child, [...path, keyName], keyName)
  }
  return sanitized
}

/**
 * Produces a reviewable fixture without preserving credentials, account data,
 * member keys, nicknames, post text, or HTTP(S) URLs. The input must be a JSON
 * value, which keeps this function side-effect-free and straightforward to test.
 */
export function sanitizeCafeArticleFixture(value: unknown): JsonValue {
  return sanitizeValue(value as JsonValue, [], null)
}

/** Parse raw response text in memory and serialize only the sanitized fixture. */
export function sanitizeCafeArticleFixtureText(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('article list response was not valid JSON')
  }
  return `${JSON.stringify(sanitizeCafeArticleFixture(parsed), null, 2)}\n`
}
