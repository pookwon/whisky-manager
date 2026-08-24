import { evaluateGuards, type Guard, type GuardEvaluation } from './guards.js'
import { decide, type Disposition } from './policy.js'
import { comparePostId } from './postId.js'
import type { RawCandidate, SourceRef } from './protocol.js'
import type { RenderOutcome } from './templates.js'
import type { ApprovalPolicy, Candidate, CommentAuthor } from './types.js'

/** Everything a post is judged against, fixed for the whole day being worked. */
export interface ScreeningContext {
  readonly automationId: string
  readonly source: SourceRef
  readonly policy: ApprovalPolicy
  readonly guards: readonly Guard[]
  readonly operatorAccounts: readonly string[]
  /**
   * The earliest post each author made in the day, by post id. Decided across
   * the whole trimmed set, so it is handed in rather than worked out per post.
   */
  readonly firstPosts: ReadonlyMap<string, string>
  /**
   * Renders the comment in question. Called exactly once per screening, because
   * a draw between several registered templates is random and a second call
   * would answer about a comment other than the one being judged.
   *
   * Required. A failed substitution is a risk flag the policy acts on, so a
   * screening that skipped rendering would reach a different verdict than the
   * run does — which is the disagreement this function exists to make
   * impossible.
   *
   * Reports failure by returning it. Throwing takes down the whole walk, since
   * nothing here catches on a post's behalf.
   */
  readonly renderBody: (candidate: Candidate) => RenderOutcome
}

/** What is known about one post at the moment it is judged. */
export interface PostFacts {
  readonly nowMs: number
  /**
   * Who has already commented, or `null` when that could not be established.
   *
   * Resolved by the caller rather than here, because the two callers reach it
   * differently: a run asks the post outright, while a count first reads the
   * tally the board list gives and asks afterwards, narrowing as answers land.
   * Both then judge through the same screening.
   */
  readonly existingCommentAuthors: readonly CommentAuthor[] | null
}

export interface Screening {
  readonly candidate: Candidate
  readonly evaluation: GuardEvaluation
  readonly disposition: Disposition
  /** The comment that was judged, so a caller posts the text it decided on. */
  readonly rendered: RenderOutcome
}

/**
 * The earliest post each author made in this collection, by post id.
 *
 * Computed rather than read off the incoming order. Collection does sort oldest
 * first, but that exists so a session stopped by its cap leaves the newest
 * behind — a separate promise that must not quietly become this rule's
 * foundation. Posts with no readable author are left out: they cannot be
 * grouped, and `firstPostOnlyGuard` hands them to the policy instead.
 */
export function firstPostIdByAuthor(raws: readonly RawCandidate[]): ReadonlyMap<string, string> {
  const earliest = new Map<string, RawCandidate>()
  for (const raw of raws) {
    if (raw.authorId === null) continue
    const held = earliest.get(raw.authorId)
    if (held === undefined || isEarlier(raw, held)) earliest.set(raw.authorId, raw)
  }
  return new Map([...earliest].map(([authorId, raw]) => [authorId, raw.postId]))
}

/** Ties break on post id so the choice never depends on collection order. */
function isEarlier(a: RawCandidate, b: RawCandidate): boolean {
  return a.postedAt === b.postedAt ? comparePostId(a.postId, b.postId) < 0 : a.postedAt < b.postedAt
}

function toCandidate(raw: RawCandidate, ctx: ScreeningContext): Candidate {
  return {
    automationId: ctx.automationId,
    cafeId: ctx.source.cafeId,
    boardId: ctx.source.boardId,
    postId: raw.postId,
    title: raw.title,
    bodyText: raw.bodyText,
    authorNickname: raw.authorNickname,
    authorId: raw.authorId,
    postedAt: raw.postedAt,
  }
}

/**
 * What should happen to one post, and the comment it was decided against.
 *
 * The one place that answer is worked out. The run that posts and the count
 * shown to the operator beforehand both arrive here, which is what stops the
 * panel from promising a number the run will not produce — the two reached it
 * separately once, and the panel offered 148 for a day that produced one.
 */
export function screenCandidate(
  raw: RawCandidate,
  ctx: ScreeningContext,
  facts: PostFacts,
): Screening {
  const candidate = toCandidate(raw, ctx)

  // Rendered before deciding so a failed substitution becomes a risk flag the
  // policy can act on, instead of being discovered too late to matter.
  const rendered = ctx.renderBody(candidate)
  const guardEvaluation = evaluateGuards(ctx.guards, candidate, {
    nowMs: facts.nowMs,
    operatorAccounts: ctx.operatorAccounts,
    existingCommentAuthors: facts.existingCommentAuthors,
    isFirstPostByAuthor: raw.authorId !== null && ctx.firstPosts.get(raw.authorId) === raw.postId,
  })

  const evaluation: GuardEvaluation = rendered.ok
    ? guardEvaluation
    : { skip: guardEvaluation.skip, flags: [...guardEvaluation.flags, 'VARIABLE_EXTRACTION_FAILED'] }

  return { candidate, evaluation, disposition: decide(ctx.policy, evaluation), rendered }
}
