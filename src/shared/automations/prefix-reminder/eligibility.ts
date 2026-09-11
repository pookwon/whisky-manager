import type { CollectedPostMetadata } from '../../cafeArticleList.js'

/**
 * Why a collected post is not a reminder target. Eligibility is decided from the
 * list row alone — prefix, board, and author are all present there — so it is
 * settled during collection rather than as a guard: a post that carries a
 * prefix, sits on an excluded board, or was written by staff is never a
 * candidate to begin with, not a candidate the run screens out later.
 */
export type Ineligibility = 'HAS_PREFIX' | 'EXCLUDED_BOARD' | 'AUTHOR_IS_OPERATOR'

export interface EligibilityRules {
  readonly excludedBoardIds: ReadonlySet<string>
  readonly operatorAccounts: readonly string[]
}

/**
 * The order the reasons are tried is the order they are reported: board first,
 * then operator, then prefix. It is fixed so a tally reads the same way twice,
 * and it goes cheapest-and-broadest first — a whole excluded board says more
 * about why nothing was collected there than a single post's prefix does.
 */
export function classifyPost(post: CollectedPostMetadata, rules: EligibilityRules): 'ELIGIBLE' | Ineligibility {
  if (rules.excludedBoardIds.has(post.boardId)) return 'EXCLUDED_BOARD'
  if (isOperator(post, rules.operatorAccounts)) return 'AUTHOR_IS_OPERATOR'
  if (post.prefix !== null) return 'HAS_PREFIX'
  return 'ELIGIBLE'
}

/**
 * An account is known by nickname or by member key, and either matches. Both
 * can be null on a list row, and a null must never match an operator whose
 * identity simply was not recorded here.
 */
function isOperator(post: CollectedPostMetadata, operatorAccounts: readonly string[]): boolean {
  const operators = new Set(operatorAccounts)
  return (
    (post.authorId !== null && operators.has(post.authorId)) ||
    (post.authorNickname !== null && operators.has(post.authorNickname))
  )
}

/**
 * A running count of what a day's walk saw and why it dropped what it dropped,
 * so the session line can say "read 40, reminded 3" rather than leaving the
 * other 37 unexplained. `read` counts only posts that were classified — the
 * collector excludes rows outside the day before they reach here.
 */
export interface EligibilityTally {
  readonly read: number
  readonly eligible: number
  readonly droppedBy: Readonly<Record<Ineligibility, number>>
}

export function emptyTally(): EligibilityTally {
  return { read: 0, eligible: 0, droppedBy: { HAS_PREFIX: 0, EXCLUDED_BOARD: 0, AUTHOR_IS_OPERATOR: 0 } }
}

/** Returns a new tally with the verdict folded in; the input is left untouched. */
export function tallyOne(tally: EligibilityTally, verdict: 'ELIGIBLE' | Ineligibility): EligibilityTally {
  if (verdict === 'ELIGIBLE') {
    return { ...tally, read: tally.read + 1, eligible: tally.eligible + 1 }
  }
  return {
    ...tally,
    read: tally.read + 1,
    droppedBy: { ...tally.droppedBy, [verdict]: tally.droppedBy[verdict] + 1 },
  }
}
