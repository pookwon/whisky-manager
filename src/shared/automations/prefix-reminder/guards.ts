import { operatorAlreadyCommentedGuard, type Guard } from '../../guards.js'

/**
 * Only one guard, and on purpose. Everything else that would disqualify a post —
 * a prefix already on it, an excluded board, a staff author — is decided from
 * the list row during collection (see `eligibility.ts`), so an ineligible post
 * never becomes a candidate the run has to screen. What the list cannot tell is
 * whether staff already left this member a reminder, because the list never
 * names who commented; that is the one thing left to check against the post
 * itself, so it is the one guard here.
 */
export const PREFIX_REMINDER_GUARDS: readonly Guard[] = [operatorAlreadyCommentedGuard]
