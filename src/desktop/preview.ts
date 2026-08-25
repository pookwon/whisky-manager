import { evaluateGuards, operatorAlreadyCommentedGuard, type GuardContext } from '../shared/guards.js'
import { firstPostOnlyGuard } from '../shared/automations/welcome-comment/firstPost.js'
import { TIMEOUTS, type RawCandidate } from '../shared/protocol.js'
import { kstDayRange } from '../shared/kst.js'
import { decide } from '../shared/policy.js'
import type { ApprovalPolicy, Candidate } from '../shared/types.js'
import { firstPostIdByAuthor } from './orchestrator.js'
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
  /** Midnight KST of the day to count. Omitted means the day `nowMs` falls in. */
  readonly dayStartMs?: number
  /** Resolves who commented on posts so we can judge whether to answer. */
  readonly lookup?: CommentAuthorLookup
  /** Called after each post is settled, so a caller can show the count narrowing. */
  readonly onNarrow?: (progress: StartupPreview) => void
}

async function collect(
  transport: ExtensionTransport,
  automationId: string,
  cafeId: string,
  boardId: string,
  newRequestId: () => string,
  sincePostedAt: number,
): Promise<RawCandidate[] | null> {
  try {
    const reply = await transport.request(
      {
        type: 'COLLECT',
        requestId: newRequestId(),
        automationId,
        source: { cafeId, boardId },
        sincePostedAt,
      },
      TIMEOUTS.collectMs,
    )
    return reply.type === 'COLLECTED' ? reply.candidates : null
  } catch {
    return null
  }
}

/**
 * How many greetings a session would answer, without answering any of them.
 * It has to reach the same number the session will, so it collects the same
 * range and applies the same guards — including the trim to the day's end,
 * which for an earlier day decides who counts as an author's first post.
 */
export async function previewDay(deps: PreviewDeps): Promise<StartupPreview> {
  if (!deps.transport.isConnected()) {
    return { kind: 'UNAVAILABLE', reason: 'BRIDGE_OFFLINE' }
  }

  const day = kstDayRange(deps.dayStartMs ?? deps.nowMs)
  const collected = await collect(deps.transport, deps.automationId, deps.cafeId, deps.boardId, deps.newRequestId, day.startMs)
  if (collected === null) {
    return { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
  }

  const raws = collected.filter((raw) => raw.postedAt < day.endMs)

  const firstPosts = firstPostIdByAuthor(raws)
  const guards = [operatorAlreadyCommentedGuard, firstPostOnlyGuard]

  interface PostWithDecision {
    raw: RawCandidate
    candidate: Candidate
    guardContext: GuardContext
  }

  const posts: PostWithDecision[] = []

  // Pre-compute candidate and guard context for each post
  for (const raw of raws) {
    const candidate: Candidate = {
      automationId: deps.automationId,
      cafeId: deps.cafeId,
      boardId: deps.boardId,
      postId: raw.postId,
      title: raw.title,
      bodyText: raw.bodyText,
      authorNickname: raw.authorNickname,
      authorId: raw.authorId,
      postedAt: raw.postedAt,
    }

    const guardContext: GuardContext = {
      nowMs: deps.nowMs,
      operatorAccounts: deps.operatorAccounts,
      existingCommentAuthors: raw.commentCount === 0 ? [] : null,
      isFirstPostByAuthor: raw.authorId !== null && firstPosts.get(raw.authorId) === raw.postId,
    }

    posts.push({ raw, candidate, guardContext })
  }

  // Initial state: separate posts by whether we need to look them up
  let count = 0
  let alreadyHandled = 0
  let pending = 0

  for (const { raw, candidate, guardContext } of posts) {
    const willComment = decide(deps.policy, evaluateGuards(guards, candidate, guardContext)).kind === 'EXECUTE'

    if (willComment && raw.commentCount === 0) {
      // Confirmed empty and will comment
      count += 1
    } else if (!willComment && (raw.commentCount === null || raw.commentCount > 0)) {
      // Won't comment but has comments (either unknown count or known count)
      if (!deps.lookup) {
        // Without lookup, we know this is already handled
        alreadyHandled += 1
      } else {
        // With lookup, we need to check first
        pending += 1
      }
    }
  }

  // Report initial state
  if (deps.onNarrow) {
    deps.onNarrow({ kind: 'READY', count, alreadyHandled, pending, checkedAt: deps.nowMs })
  }

  // If there's no lookup, return the initial state
  if (!deps.lookup) {
    return { kind: 'READY', count, alreadyHandled, pending: 0, checkedAt: deps.nowMs }
  }

  // Now resolve pending posts via lookup
  for (const { raw, candidate, guardContext } of posts) {
    if (raw.commentCount === null || raw.commentCount > 0) {
      const authors = await deps.lookup.resolve(raw.postId, raw.commentCount)

      // Create new guard context with real comment authors
      const resolvedContext: GuardContext = {
        ...guardContext,
        existingCommentAuthors: authors,
      }

      // Re-evaluate the decision with the real comment authors
      const decision = decide(deps.policy, evaluateGuards(guards, candidate, resolvedContext))
      const willComment = decision.kind === 'EXECUTE'

      if (willComment) {
        count += 1
      } else if (authors !== null && authors.length > 0) {
        // Only count as already handled if the lookup succeeded with non-empty authors
        alreadyHandled += 1
      }

      pending -= 1

      // Report progress as each lookup lands
      if (deps.onNarrow) {
        deps.onNarrow({ kind: 'READY', count, alreadyHandled, pending, checkedAt: deps.nowMs })
      }
    }
  }

  return { kind: 'READY', count, alreadyHandled, pending: 0, checkedAt: deps.nowMs }
}
