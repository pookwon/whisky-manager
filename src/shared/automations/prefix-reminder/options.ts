/**
 * What the operator sets for the prefix-reminder automation, and how it is
 * carried in `AutomationSetting.optionsJson`.
 *
 * `commentText` is the operator's own wording, which may name the author it is
 * aimed at. `nicknameFallback` is what goes in when the post carries no
 * readable nickname. It ships with a word in it so the reminder goes out on its
 * own rather than waiting on an operator who never found the field; clearing it
 * is the deliberate opposite — do not guess, leave the post alone rather than
 * comment on it with a hole in the sentence. `excludedBoardIds` names the
 * boards where a missing prefix is not a mistake — a board with no prefixes at
 * all should never prompt anyone.
 */
export interface PrefixReminderOptions {
  readonly commentText: string
  readonly nicknameFallback: string
  readonly excludedBoardIds: readonly string[]
}

/**
 * The word the reminder addresses an unreadable author by until someone
 * chooses another. Neutral on purpose: it goes out under posts by people
 * nobody has met, so it has to read as ordinary rather than as a guess.
 */
export const DEFAULT_NICKNAME_FALLBACK = '회원'

export const DEFAULT_PREFIX_REMINDER_OPTIONS: PrefixReminderOptions = {
  commentText: '',
  nicknameFallback: DEFAULT_NICKNAME_FALLBACK,
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
    commentText: readText(parsed.commentText, ''),
    // The two ways this key can be missing do not mean the same thing. Absent
    // is a blob written before the field existed, or one that never had it —
    // nobody decided anything, so it gets the default. Present and blank is an
    // operator who cleared it, which is a decision: do not guess a name.
    nicknameFallback: readText(parsed.nicknameFallback, DEFAULT_NICKNAME_FALLBACK),
    excludedBoardIds: normalizeBoardIds(parsed.excludedBoardIds),
  }
}

/**
 * Trimmed, because a field holding only spaces is one an operator cleared.
 * Anything that is not a string at all is storage nobody wrote through the
 * app, so it reads as the default rather than as a decision.
 */
function readText(value: unknown, absent: string): string {
  return typeof value === 'string' ? value.trim() : absent
}

export function serializePrefixReminderOptions(options: PrefixReminderOptions): string {
  return JSON.stringify({
    commentText: options.commentText,
    nicknameFallback: options.nicknameFallback,
    excludedBoardIds: options.excludedBoardIds,
  })
}
