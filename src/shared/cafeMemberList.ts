/**
 * Pure contract for the ManageMemberListViewAjax member-list response captured in
 * Phase 0. This module knows neither how a response is fetched nor where its
 * results are stored; both boundaries need a malformed response to fail loudly
 * rather than look like an empty, successful page. The management API returns
 * `isSuccess` as a JSON boolean, unlike the memo-comment API's string "true", so
 * that parser is not reused.
 */
import { decodeHtmlEntities } from './htmlEntities.js'

export interface CollectedMember {
  readonly memberKey: string
  readonly nickname: string | null
  /** KST calendar date as ISO `YYYY-MM-DD`, converted from `YYYY.MM.DD.`. */
  readonly joinDate: string
  /** HTML entities decoded. */
  readonly levelName: string
  readonly isManager: boolean
  readonly isStaff: boolean
}

export interface CollectedMemberPage {
  readonly items: readonly CollectedMember[]
  /** Versioned identity of the page's sorted member keys. */
  readonly pageIdentity: string
}

/** Stamped on every observation this parser produces; bump it when the mapping changes. */
export const CAFE_MEMBER_LIST_PARSER_VERSION = 'member-list-v1'

export type CafeMemberListParseErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_ENVELOPE'
  | 'NOT_SUCCESS'
  | 'INVALID_MEMBER'
  | 'DUPLICATE_MEMBER_KEY'

export class CafeMemberListParseError extends Error {
  constructor(
    readonly code: CafeMemberListParseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CafeMemberListParseError'
  }
}

type JsonRecord = Record<string, unknown>

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const FNV_MASK = 0xffffffffffffffffn
const JOIN_DATE = /^(\d{4})\.(\d{2})\.(\d{2})\.$/

function fail(code: CafeMemberListParseErrorCode, message: string): never {
  throw new CafeMemberListParseError(code, message)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function requiredString(record: JsonRecord, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string') fail('INVALID_MEMBER', `${path}.${key} must be a string`)
  return value
}

function nullableString(record: JsonRecord, key: string, path: string): string | null {
  if (!hasOwn(record, key)) fail('INVALID_MEMBER', `${path}.${key} is missing`)
  const value = record[key]
  if (value === null || typeof value === 'string') return value
  return fail('INVALID_MEMBER', `${path}.${key} must be a string or null`)
}

function requiredBoolean(record: JsonRecord, key: string, path: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') fail('INVALID_MEMBER', `${path}.${key} must be a boolean`)
  return value
}

function joinDateIso(record: JsonRecord, path: string): string {
  const raw = requiredString(record, 'joinDate', path)
  const match = JOIN_DATE.exec(raw)
  if (match === null) fail('INVALID_MEMBER', `${path}.joinDate must be YYYY.MM.DD.`)
  return `${match[1]}-${match[2]}-${match[3]}`
}

function parseMember(entry: unknown, index: number): CollectedMember {
  const path = `result.members[${index}]`
  if (!isRecord(entry)) fail('INVALID_MEMBER', `${path} must be an object`)
  return {
    memberKey: requiredString(entry, 'memberKey', path),
    nickname: nullableString(entry, 'nickname', path),
    joinDate: joinDateIso(entry, path),
    levelName: decodeHtmlEntities(requiredString(entry, 'memberLevelName', path)),
    isManager: requiredBoolean(entry, 'manager', path),
    isStaff: requiredBoolean(entry, 'staff', path),
  }
}

/**
 * FNV-1a 64 over `member-page-v1\0` and the member keys sorted by code unit and
 * separated by NUL. Deliberately implemented with only ECMAScript primitives so
 * browser-extension and Node code always agree. An empty list has a valid,
 * distinct identity; whether it terminates the walk is the orchestration's call.
 */
export function cafeMemberPageIdentity(memberKeys: readonly string[]): string {
  const canonical = `member-page-v1\u0000${[...memberKeys].sort().join('\u0000')}`
  let hash = FNV_OFFSET_BASIS
  for (const character of canonical) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * FNV_PRIME) & FNV_MASK
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function parseCafeMemberList(value: unknown): CollectedMemberPage {
  if (!isRecord(value)) fail('INVALID_ENVELOPE', 'response must be an object')
  // The management API answers with a JSON boolean, so anything else — including
  // the string "true" — is a contract change and rejects the whole page.
  if (value.isSuccess !== true) fail('NOT_SUCCESS', 'response.isSuccess must be boolean true')
  if (!isRecord(value.result)) fail('INVALID_ENVELOPE', 'response.result must be an object')
  if (!Array.isArray(value.result.members)) fail('INVALID_ENVELOPE', 'result.members must be an array')

  const items = value.result.members.map((entry, index) => parseMember(entry, index))
  const keys = new Set<string>()
  for (const item of items) {
    if (keys.has(item.memberKey)) fail('DUPLICATE_MEMBER_KEY', `result.members has duplicate memberKey`)
    keys.add(item.memberKey)
  }
  return { items, pageIdentity: cafeMemberPageIdentity(items.map((item) => item.memberKey)) }
}

/** Parses decoded response text without treating an HTML/login page as an empty list. */
export function parseCafeMemberListText(text: string): CollectedMemberPage {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail('INVALID_JSON', 'member-list response is not valid JSON')
  }
  return parseCafeMemberList(value)
}
