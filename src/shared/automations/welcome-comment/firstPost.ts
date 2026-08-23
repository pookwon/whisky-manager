import type { Guard, GuardOutcome } from '../../guards.js'

/**
 * One greeting per person. When someone posts more than once in a day only
 * their earliest post is answered; the rest are already covered by it.
 *
 * A post whose author could not be read cannot be grouped at all. Treating
 * such posts as one person would drop unrelated people at once, and treating
 * each as its own person would greet someone twice — so the post is flagged
 * and the approval policy decides.
 */
export const firstPostOnlyGuard: Guard = (candidate, ctx): GuardOutcome => {
  if (candidate.authorId === null) return { kind: 'RISK', flag: 'AUTHOR_UNKNOWN' }
  return ctx.isFirstPostByAuthor ? null : { kind: 'SKIP', reason: 'NOT_FIRST_POST' }
}
