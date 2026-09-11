/**
 * The excluded-board textarea, read as the ids it names.
 *
 * Refused whole at the first bad line rather than saved without it: the stored
 * reader drops anything that is not digits, so a typo let through here would
 * be a board the operator believes is excluded and the automation comments on
 * anyway. The line is named trimmed, the way it reads on the screen.
 */
export type ExcludedBoardLines =
  | { readonly ok: true; readonly ids: string[] }
  | { readonly ok: false; readonly invalid: string }

const BOARD_ID = /^\d+$/

export function parseExcludedBoardLines(text: string): ExcludedBoardLines {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  const invalid = lines.find((line) => !BOARD_ID.test(line))
  return invalid === undefined ? { ok: true, ids: lines } : { ok: false, invalid }
}
