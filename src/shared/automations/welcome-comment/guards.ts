import { operatorAlreadyCommentedGuard, type Guard } from '../../guards.js'
import { firstPostOnlyGuard } from './firstPost.js'

/**
 * What a greeting is screened against.
 *
 * One list, read by the run that posts and by the count shown to the operator
 * beforehand. Kept here rather than written out at each of those call sites
 * because the two must reach the same verdict: a guard added to the run but not
 * to the count would promise comments that never go out, which is the mistake
 * that once offered 148 for a day that produced one.
 */
export const WELCOME_GUARDS: readonly Guard[] = [operatorAlreadyCommentedGuard, firstPostOnlyGuard]
