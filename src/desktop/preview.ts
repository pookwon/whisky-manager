import type { Guard } from '../shared/guards.js'
import type { RawCandidate } from '../shared/protocol.js'
import { firstPostIdByAuthor, screenCandidate, type ScreeningContext } from '../shared/screening.js'
import type { RenderOutcome } from '../shared/templates.js'
import type { ApprovalPolicy, Candidate, CommentAuthor } from '../shared/types.js'
import { collectDay } from './collection.js'
import type { ExtensionTransport } from './ws/server.js'
import type { CommentAuthorLookup } from './commentAuthors.js'

export type StartupPreview =
  | {
      kind: 'READY'
      /** Posts that will actually be commented on under the current policy. */
      count: number
      /** Posts on that day that somebody has already answered. */
      alreadyHandled: number
      /** Posts still waiting on a lookup before they can be judged. */
      pending: number
      checkedAt: number
    }
  | { kind: 'UNAVAILABLE'; reason: 'BRIDGE_OFFLINE' | 'READ_FAILED' | 'NOT_CONFIGURED' }

export interface PreviewDeps {
  readonly transport: ExtensionTransport
  readonly cafeId: string
  readonly boardId: string
  readonly automationId: string
  readonly nowMs: number
  readonly newRequestId: () => string
  readonly operatorAccounts: readonly string[]
  /**
   * The approval policy in force. It decides what a risk flag means, and a
   * flagged post under AUTO is one that will not be commented on — so a count
   * taken without it promises comments that never go out.
   */
  readonly policy: ApprovalPolicy
  /** What a post is screened against. The run's own list, handed in by the caller. */
  readonly guards: readonly Guard[]
  /**
   * Whether a comment could be written for this post, and one that could.
   *
   * Counting without rendering at all was the last place this and the run could
   * disagree: an unfillable variable is a risk flag the policy acts on, and with
   * nothing registered every post fails to render — a run that posts nothing,
   * which the count used to report as the whole day.
   *
   * Deliberately not the run's own draw. See `renderAnyWelcomeComment`.
   */
  readonly renderBody: (candidate: Candidate) => RenderOutcome
  /** Midnight KST of the day to count. Omitted means the day `nowMs` falls in. */
  readonly dayStartMs?: number
  /** Resolves who commented on posts so we can judge whether to answer. */
  readonly lookup?: CommentAuthorLookup
  /** Called after each post is settled, so a caller can show the count narrowing. */
  readonly onNarrow?: (progress: StartupPreview) => void
}

/**
 * How many greetings a run would answer, without answering any of them.
 *
 * Every post is judged the way the run judges it, through the same
 * `screenCandidate`: the same guards, the same render, the same policy.
 * Nothing is decided here — this asks and counts.
 *
 * The upper-bound reading — fewer comments than this may go out, never more —
 * only holds once a lookup has settled `pending` to zero. A post that already
 * carries comments cannot be judged from the board list alone: given a lookup
 * it is asked about and judged like any other, but without one it is set aside
 * as `alreadyHandled`, unjudged, while the run still resolves it and may answer
 * a post whose only commenters are ordinary members. So the no-lookup figure
 * can fall short of what the run posts. The real app always passes a lookup;
 * the bare path exists for callers that want only the board-list tally.
 *
 * Even fully resolved, the figure sees no further than the post itself. A run
 * also stops for reasons no post can show: the automation switched off, the
 * kill switch, a window that has spent its allowance. It skips posts an earlier
 * run already claimed but never answered. And a forced run deliberately passes
 * the operating window and the backlog brake, which is the very panel this
 * number is shown in.
 */
export async function previewDay(deps: PreviewDeps): Promise<StartupPreview> {
  if (!deps.transport.isConnected()) {
    return { kind: 'UNAVAILABLE', reason: 'BRIDGE_OFFLINE' }
  }

  const raws = await collectDay({
    transport: deps.transport,
    automationId: deps.automationId,
    source: { cafeId: deps.cafeId, boardId: deps.boardId },
    newRequestId: deps.newRequestId,
    dayStartMs: deps.dayStartMs ?? deps.nowMs,
  })
  if (raws === null) {
    return { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
  }

  const screening: ScreeningContext = {
    automationId: deps.automationId,
    source: { cafeId: deps.cafeId, boardId: deps.boardId },
    policy: deps.policy,
    guards: deps.guards,
    operatorAccounts: deps.operatorAccounts,
    firstPosts: firstPostIdByAuthor(raws),
    renderBody: deps.renderBody,
  }

  /** The run's own verdict on this post, given what is known of its comments. */
  const wouldAnswer = (
    raw: RawCandidate,
    existingCommentAuthors: readonly CommentAuthor[] | null,
  ): boolean =>
    screenCandidate(raw, screening, { nowMs: deps.nowMs, existingCommentAuthors }).disposition
      .kind === 'EXECUTE'

  let count = 0
  let alreadyHandled = 0
  let pending = 0

  // What the board list alone can settle. A tally of zero is the board stating
  // nobody has commented, which needs no request; anything else cannot be
  // judged until the post itself is asked.
  for (const raw of raws) {
    if (raw.commentCount === 0) {
      if (wouldAnswer(raw, [])) count += 1
      continue
    }
    if (deps.lookup === undefined) alreadyHandled += 1
    else pending += 1
  }

  deps.onNarrow?.({ kind: 'READY', count, alreadyHandled, pending, checkedAt: deps.nowMs })

  const lookup = deps.lookup
  if (lookup === undefined) {
    return { kind: 'READY', count, alreadyHandled, pending: 0, checkedAt: deps.nowMs }
  }

  // Then the rest, one answer at a time, so the operator watches the figure
  // narrow rather than waiting on a screen that says nothing.
  for (const raw of raws) {
    if (raw.commentCount === 0) continue

    const authors = await lookup.resolve(raw.postId, raw.commentCount)
    if (wouldAnswer(raw, authors)) {
      count += 1
    } else if (authors !== null && authors.length > 0) {
      // Only the lookup can prove somebody got there first. A failed read
      // proves nothing and must not be reported as answered.
      alreadyHandled += 1
    }

    pending -= 1
    deps.onNarrow?.({ kind: 'READY', count, alreadyHandled, pending, checkedAt: deps.nowMs })
  }

  return { kind: 'READY', count, alreadyHandled, pending: 0, checkedAt: deps.nowMs }
}
