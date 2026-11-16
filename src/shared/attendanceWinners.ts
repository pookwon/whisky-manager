import { decodeHtmlEntities } from './htmlEntities.js'

/**
 * Reads the winners an attendance post names. The cafe writes the list as one
 * run of plain text that ends with a fixed closing phrase, so splitting on tags
 * and then on the separator is enough — no DOM is needed. The parser never
 * guesses: a body it cannot be sure of is refused with the rule that caught it,
 * and an attendance post with a real list of winners is the only shape it reads.
 */

const CLOSING_PHRASE = '님이 당첨 되셨습니다'
const NICKNAME_SEPARATOR = '님, '
// The shared decoder knows only the entities the management API sends; the
// cafe editor also writes non-breaking spaces into post bodies. They are spaces
// to a reader, so they are folded before the phrase and the separator are
// looked for — one standing in for the space of `님, ` must not hide a split.
const NON_BREAKING_SPACE_ENTITY = /&(?:nbsp|#160|#x0*a0);/gi

export type AttendanceWinnersRule = 'NO_CLOSING_PHRASE' | 'NO_WINNERS' | 'EMPTY_NICKNAME'
export type AttendanceWinners =
  | { readonly ok: true; readonly nicknames: readonly string[] }
  | { readonly ok: false; readonly rule: AttendanceWinnersRule }

export function parseAttendanceWinners(contentHtml: string): AttendanceWinners {
  const list = lastTextRunWithClosingPhrase(contentHtml)
  if (list === null) {
    return { ok: false, rule: 'NO_CLOSING_PHRASE' }
  }

  const beforePhrase = list.slice(0, list.indexOf(CLOSING_PHRASE))
  if (beforePhrase.length === 0) {
    return { ok: false, rule: 'NO_WINNERS' }
  }

  // Decode before measuring: a nickname written as an entity alone is empty
  // once decoded, and checking the raw text would let it through as a blank winner.
  const nicknames = beforePhrase
    .split(NICKNAME_SEPARATOR)
    .map((piece) => collapseWhitespace(decodeHtmlEntities(piece)))
  if (nicknames.some((nickname) => nickname.length === 0)) {
    return { ok: false, rule: 'EMPTY_NICKNAME' }
  }

  return { ok: true, nicknames }
}

/** The last text run naming the closing phrase, with its spaces already folded. */
function lastTextRunWithClosingPhrase(contentHtml: string): string | null {
  const runs = contentHtml.split(/<[^>]*>/)
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = collapseWhitespace((runs[index] ?? '').replace(NON_BREAKING_SPACE_ENTITY, ' '))
    if (run.includes(CLOSING_PHRASE)) {
      return run
    }
  }
  return null
}

/** `\s` covers U+00A0, so a decoded non-breaking space folds like any other. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
