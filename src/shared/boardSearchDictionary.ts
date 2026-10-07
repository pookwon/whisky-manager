import { isBoardSearchQuery } from './cafeBoardSearchEndpoint.js'

/**
 * Picks the title searches that recover a board's posts past the list horizon.
 *
 * The board's own list stops at page 1000, but its title search does not, and
 * the search matches the analyser's whole-word tokens; '홈플' finds
 * '동광주홈플' but not '월드컵 홈플러스' (measured 2026-09-26), so a picked word
 * does not stand for its longer forms, and extendBoardSearchQueries asks those
 * forms themselves. No one query covers a board, so this builds a union: the
 * stored titles stand in for the missing ones, and each pick is the word that
 * catches the most titles the earlier picks did not. Latin and digit words match less predictably ('gs'
 * does not find 'gs25'); the order stays a good one, and each query's real
 * yield is read off the search's own total.
 */

export interface BoardSearchQuery {
  readonly query: string
  /** Stored titles this query catches that no earlier query did. */
  readonly expectedGain: number
}

export const BOARD_SEARCH_QUERY_LIMIT = 300
export const BOARD_SEARCH_MIN_GAIN = 5
export const BOARD_SEARCH_CANDIDATE_LIMIT = 4000
/** How many longer forms of the picked words a job may add after its picks. */
export const BOARD_SEARCH_EXTENSION_LIMIT = 300

const MIN_WORD_LENGTH = 2
const WORD_SEPARATOR = /[^0-9a-z가-힣]+/u

export function titleWords(title: string): readonly string[] {
  return title.toLowerCase().split(WORD_SEPARATOR).filter((word) => word.length > 0)
}

interface Candidate {
  readonly word: string
  /** Titles a search for this word would bring, as indexes into the title list. */
  readonly caught: readonly number[]
  /** Titles that use this word itself, for breaking ties. */
  readonly uses: number
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function candidatesOf(words: readonly (readonly string[])[], candidateLimit: number): readonly Candidate[] {
  const uses = new Map<string, number>()
  for (const titleWordList of words) {
    for (const word of new Set(titleWordList)) {
      // A word the search would refuse is never a candidate, however common.
      if (isBoardSearchQuery(word)) uses.set(word, (uses.get(word) ?? 0) + 1)
    }
  }
  const kept = [...uses.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodeUnits(a[0], b[0]))
    .slice(0, candidateLimit)
  const caught = new Map<string, number[]>(kept.map(([word]) => [word, []]))
  words.forEach((titleWordList, index) => {
    const seen = new Set<string>()
    for (const word of titleWordList) {
      for (let length = MIN_WORD_LENGTH; length <= word.length; length += 1) {
        const prefix = word.slice(0, length)
        if (seen.has(prefix)) continue
        const list = caught.get(prefix)
        if (list === undefined) continue
        list.push(index)
        seen.add(prefix)
      }
    }
  })
  return kept.map(([word, count]) => ({ word, caught: caught.get(word) ?? [], uses: count }))
}

/**
 * The greedy cover: each pick is the candidate catching the most titles no
 * earlier pick caught; a tie goes to the word more titles use, then to the
 * lower code units. It stops at `limit` picks or below `minGain`.
 */
function pickGreedily(candidates: readonly Candidate[], limit: number, minGain: number): readonly BoardSearchQuery[] {
  const covered = new Set<number>()
  const picked: BoardSearchQuery[] = []
  const used = new Set<string>()
  while (picked.length < limit) {
    let best: Candidate | null = null
    let bestGain = 0
    for (const candidate of candidates) {
      if (used.has(candidate.word)) continue
      const gain = candidate.caught.reduce((count, index) => (covered.has(index) ? count : count + 1), 0)
      const better =
        gain > bestGain ||
        (gain === bestGain &&
          best !== null &&
          (candidate.uses > best.uses || (candidate.uses === best.uses && compareCodeUnits(candidate.word, best.word) < 0)))
      if (better) {
        best = candidate
        bestGain = gain
      }
    }
    if (best === null || bestGain < minGain) break
    used.add(best.word)
    for (const index of best.caught) covered.add(index)
    picked.push({ query: best.word, expectedGain: bestGain })
  }
  return picked
}

export function buildBoardSearchDictionary(
  titles: readonly string[],
  options: { readonly limit?: number; readonly minGain?: number; readonly candidateLimit?: number } = {},
): readonly BoardSearchQuery[] {
  const candidates = candidatesOf(titles.map(titleWords), options.candidateLimit ?? BOARD_SEARCH_CANDIDATE_LIMIT)
  return pickGreedily(candidates, options.limit ?? BOARD_SEARCH_QUERY_LIMIT, options.minGain ?? BOARD_SEARCH_MIN_GAIN)
}

/** Whether `word` is longer than, and starts with, one of the asked queries. */
function extendsAsked(word: string, asked: ReadonlySet<string>): boolean {
  for (let length = MIN_WORD_LENGTH; length < word.length; length += 1) {
    if (asked.has(word.slice(0, length))) return true
  }
  return false
}

/**
 * The longer forms of the asked queries that are worth asking themselves.
 *
 * The search matches whole words, so '홈플' leaves '월드컵 홈플러스' behind. A
 * title an asked query matches as a whole word is already found; each pick is
 * the extending word written in the most titles that no asked query and no
 * earlier pick finds, by the same greedy cover as `buildBoardSearchDictionary`.
 */
export function extendBoardSearchQueries(
  titles: readonly string[],
  queries: readonly string[],
  options: { readonly limit?: number; readonly minGain?: number } = {},
): readonly BoardSearchQuery[] {
  const asked = new Set(queries)
  const caught = new Map<string, number[]>()
  const uses = new Map<string, number>()
  titles.forEach((title, index) => {
    const words = new Set(titleWords(title))
    const found = [...words].some((word) => asked.has(word))
    for (const word of words) {
      if (asked.has(word) || !isBoardSearchQuery(word) || !extendsAsked(word, asked)) continue
      uses.set(word, (uses.get(word) ?? 0) + 1)
      if (found) continue
      const list = caught.get(word) ?? []
      list.push(index)
      caught.set(word, list)
    }
  })
  const candidates = [...caught].map(([word, list]): Candidate => ({ word, caught: list, uses: uses.get(word) ?? 0 }))
  return pickGreedily(candidates, options.limit ?? BOARD_SEARCH_EXTENSION_LIMIT, options.minGain ?? BOARD_SEARCH_MIN_GAIN)
}
