import type { ApprovalPolicy } from './types.js'

/**
 * The settings file's shape, and the only thing that reads one.
 *
 * A file the operator picked is not this tool's output until it has been read
 * as such. It may be another app's export, a newer version of this one, or a
 * text file that happens to end in `.json`. Deciding that needs no database and
 * no filesystem, so it lives in `shared`: the main process and the tests reach
 * the same judgement, and nothing gets into a repository without passing here.
 */

/** Bumped when the shape changes in a way an older build cannot read. */
export const CONFIG_BUNDLE_VERSION = 1

const POLICIES: readonly ApprovalPolicy[] = ['AUTO', 'SEMI', 'MANUAL']

export interface BundleTemplate {
  readonly body: string
  readonly enabled: boolean
}

export interface BundleAutomation {
  readonly id: string
  readonly policy: ApprovalPolicy
  /** Empty means the exporting install never named a board. */
  readonly boardId: string
  /**
   * Whether the exporting install had this automation switched on. Written
   * down because it is part of what was tested, and deliberately not obeyed on
   * the way in — see `applyBundle`.
   */
  readonly enabled: boolean
  readonly templates: readonly BundleTemplate[]
}

export interface BundleCommon {
  readonly cafeId: string
  readonly cafeUrlName: string
  readonly operatorAccounts: readonly string[]
}

export interface ConfigBundle {
  readonly version: number
  readonly exportedAt: number
  readonly common: BundleCommon
  readonly automations: readonly BundleAutomation[]
}

/**
 * Why a file was refused. Keyed into `TEXT` as a Record, so a reason added
 * here without words to go with it fails the build rather than reaching the
 * screen as a raw enum name.
 */
export type BundleProblem = 'NOT_JSON' | 'NOT_A_BUNDLE' | 'UNSUPPORTED_VERSION' | 'NO_CAFE'

export type BundleParse =
  | { readonly ok: true; readonly bundle: ConfigBundle }
  | { readonly ok: false; readonly problem: BundleProblem }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Trimmed, or empty when the field is absent or not a string. */
function str(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isPolicy(value: unknown): value is ApprovalPolicy {
  return typeof value === 'string' && (POLICIES as readonly string[]).includes(value)
}

/** Blank and duplicate accounts are dropped; neither means anything downstream. */
function parseAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const accounts = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed !== '') accounts.add(trimmed)
  }
  return [...accounts]
}

function parseTemplates(value: unknown): BundleTemplate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): BundleTemplate[] => {
    const record = asRecord(entry)
    if (record === null) return []
    const body = typeof record.body === 'string' ? record.body.trim() : ''
    // A blank body would post an empty comment, which is the one thing a
    // template must never be. Dropping it here keeps that unreachable.
    if (body === '') return []
    // Absent means enabled: a file hand-written without the field should give
    // the operator working templates, not silently disabled ones.
    return [{ body, enabled: record.enabled !== false }]
  })
}

/** Null when any entry is unreadable — a partly understood list is not a bundle. */
function parseAutomations(value: unknown): BundleAutomation[] | null {
  if (!Array.isArray(value)) return null
  const parsed: BundleAutomation[] = []
  for (const entry of value) {
    const record = asRecord(entry)
    if (record === null) return null
    const id = str(record, 'id')
    if (id === '' || !isPolicy(record.policy)) return null
    parsed.push({
      id,
      policy: record.policy,
      boardId: str(record, 'boardId'),
      enabled: record.enabled === true,
      templates: parseTemplates(record.templates),
    })
  }
  return parsed
}

export function parseConfigBundle(raw: string): BundleParse {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, problem: 'NOT_JSON' }
  }

  const record = asRecord(value)
  if (record === null || typeof record.version !== 'number') {
    return { ok: false, problem: 'NOT_A_BUNDLE' }
  }
  // Version before shape. A file written by a newer build should say so rather
  // than have its unfamiliar fields blamed on the operator picking wrongly.
  if (record.version !== CONFIG_BUNDLE_VERSION) {
    return { ok: false, problem: 'UNSUPPORTED_VERSION' }
  }

  const common = asRecord(record.common)
  if (common === null) return { ok: false, problem: 'NOT_A_BUNDLE' }

  const automations = parseAutomations(record.automations)
  if (automations === null) return { ok: false, problem: 'NOT_A_BUNDLE' }

  const cafeId = str(common, 'cafeId')
  // Accepting this would hand the operator a screen full of settings and a
  // session that still refuses to open. Refusing the file says why.
  if (cafeId === '') return { ok: false, problem: 'NO_CAFE' }

  return {
    ok: true,
    bundle: {
      version: CONFIG_BUNDLE_VERSION,
      exportedAt: typeof record.exportedAt === 'number' ? record.exportedAt : 0,
      common: {
        cafeId,
        cafeUrlName: str(common, 'cafeUrlName'),
        operatorAccounts: parseAccounts(common.operatorAccounts),
      },
      automations,
    },
  }
}

/** Indented on purpose: a settings file is something a person may open and read. */
export function serializeConfigBundle(bundle: ConfigBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}
