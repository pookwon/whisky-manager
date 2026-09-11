/**
 * What the operator sets for the prefix-reminder automation, and how it is
 * carried in `AutomationSetting.optionsJson`.
 *
 * `commentText` is fixed wording rather than a template: the reminder says the
 * same thing to everyone who forgot a prefix, so there is no variable to draw
 * and no per-post substitution to fail. `excludedBoardIds` names the boards
 * where a missing prefix is not a mistake — a board with no prefixes at all
 * should never prompt anyone.
 */
export interface PrefixReminderOptions {
  readonly commentText: string
  readonly excludedBoardIds: readonly string[]
}

export const DEFAULT_PREFIX_REMINDER_OPTIONS: PrefixReminderOptions = {
  commentText: '',
  excludedBoardIds: [],
}

const DIGITS = /^\d+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A board id is a menu id — digits only. Anything else in the stored list is an
 * artefact of hand editing or a shape change, so it is dropped rather than
 * carried into a comparison that would silently never match. Trimmed because a
 * stray space would make `' 147 '` a board that does not exist, and deduplicated
 * because the set it feeds cannot hold two of the same anyway.
 */
function normalizeBoardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (DIGITS.test(trimmed)) seen.add(trimmed)
  }
  return [...seen]
}

/**
 * Broken or absent storage reads as the defaults rather than throwing: a
 * malformed options blob must not stop the automation from booting, it just
 * means nothing has been configured yet.
 */
export function parsePrefixReminderOptions(json: string): PrefixReminderOptions {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return DEFAULT_PREFIX_REMINDER_OPTIONS
  }
  if (!isRecord(parsed)) return DEFAULT_PREFIX_REMINDER_OPTIONS
  return {
    commentText: typeof parsed.commentText === 'string' ? parsed.commentText.trim() : '',
    excludedBoardIds: normalizeBoardIds(parsed.excludedBoardIds),
  }
}

export function serializePrefixReminderOptions(options: PrefixReminderOptions): string {
  return JSON.stringify({
    commentText: options.commentText,
    excludedBoardIds: options.excludedBoardIds,
  })
}
