/**
 * When the search backfill stops paying for itself.
 *
 * The article id probe follows the search and reads every id hole of the
 * period one request at a time, so each post the search brings in saves the
 * probe exactly one request. A search page is worth its request only while it
 * brings in at least one new post: below that, reading the ids is cheaper and
 * misses nothing. Measured on board 137's 2024 job (2026-10-08): 232 of 543
 * queries brought no new post over 2,989 pages, nearly all of them longer
 * forms the analyser already matched through their stem ('구매했습니다').
 */

/** The stop reason of a search run that ended below the probe's yield. */
export const BELOW_PROBE_YIELD = 'BELOW_PROBE_YIELD'

/** How many of a run's latest requests the yield is read over. */
export const BOARD_SEARCH_YIELD_WINDOW = 2

/** The posts a request must bring in to beat reading their ids one by one. */
const PROBE_POSTS_PER_REQUEST = 1

/** How many finished queries in a row below the probe's yield end the board's search. */
export const BOARD_SEARCH_GIVE_UP_STREAK = 20

/** The new posts each of the run's latest requests brought in, oldest first, after one more request. */
export function recordRequestYield(recent: readonly number[], inserted: number): readonly number[] {
  return [...recent, inserted].slice(-BOARD_SEARCH_YIELD_WINDOW)
}

/** Whether the requests brought in fewer posts than reading their ids would have cost. */
function isBelowProbeYield(recent: readonly number[]): boolean {
  const inserted = recent.reduce((sum, count) => sum + count, 0)
  return inserted < recent.length * PROBE_POSTS_PER_REQUEST
}

export interface BoardSearchRunYield {
  /** New posts the query brought in before this run. */
  readonly insertedBefore: number
  readonly inserted: number
  readonly requests: number
}

/**
 * Whether a query that reached its end paid for the run that ended it. What it
 * brought in before counts: a resumed query whose last page is the empty one
 * past the end has paid for that request long before.
 */
export function endsBelowProbeYield(run: BoardSearchRunYield): boolean {
  return run.insertedBefore + run.inserted < run.requests * PROBE_POSTS_PER_REQUEST
}

/** A query stops mid-walk only on a full window, so one thin page does not end a rich query. */
export function shouldStopBelowProbeYield(recent: readonly number[]): boolean {
  return recent.length === BOARD_SEARCH_YIELD_WINDOW && isBelowProbeYield(recent)
}

export interface EndedBoardSearchQuery {
  readonly complete: boolean
  readonly belowProbeYield: boolean
}

/** How many of the last finished queries, in queue order, ended below the probe's yield. */
export function belowProbeYieldStreak(queries: readonly EndedBoardSearchQuery[]): number {
  return queries
    .filter((query) => query.complete)
    .reduce((streak, query) => (query.belowProbeYield ? streak + 1 : 0), 0)
}

/**
 * The queue is ordered by expected gain, so a long run of queries that did
 * not pay says the ones after them will not either; the probe reaches what
 * they would have found.
 */
export function isSearchGivenUp(queries: readonly EndedBoardSearchQuery[]): boolean {
  return belowProbeYieldStreak(queries) >= BOARD_SEARCH_GIVE_UP_STREAK
}
