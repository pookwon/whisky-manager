import { evaluateGuards, operatorAlreadyCommentedGuard, type GuardContext } from '../shared/guards.js'
import { firstPostOnlyGuard } from '../shared/automations/welcome-comment/firstPost.js'
import { TIMEOUTS, type RawCandidate } from '../shared/protocol.js'
import { kstDayRange } from '../shared/kst.js'
import { decide } from '../shared/policy.js'
import type { ApprovalPolicy, Candidate } from '../shared/types.js'
import { firstPostIdByAuthor } from './orchestrator.js'
import type { ExtensionTransport } from './ws/server.js'

export type StartupPreview =
  | {
      kind: 'READY'
      /** Posts that will actually be commented on under the current policy. */
      count: number
      /** Posts on that day that somebody has already answered. */
      alreadyHandled: number
      checkedAt: number
    }
  | { kind: 'UNAVAILABLE'; reason: 'BRIDGE_OFFLINE' | 'READ_FAILED' }

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
  let count = 0
  let alreadyHandled = 0

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

    // The list gives a count, never the names. Until the lookup lands, a count
    // above zero is handed on as "unknown", which is what the guards already do
    // with it — behaviour is unchanged and only the source of the value moved.
    const existingCommentAuthors = raw.commentCount === 0 ? [] : null
    const guardContext: GuardContext = {
      nowMs: deps.nowMs,
      operatorAccounts: deps.operatorAccounts,
      existingCommentAuthors,
      isFirstPostByAuthor: raw.authorId !== null && firstPosts.get(raw.authorId) === raw.postId,
    }

    // Read off the post rather than off the verdict: the operator is asking
    // whether the greeting has been answered, and an empty list is the board
    // saying nobody has. `null` is a comment count above zero the list will
    // not name, which on this board means somebody got there first.
    if (raw.commentCount === null || raw.commentCount > 0) {
      alreadyHandled += 1
    }

    // The same decision the session will reach, so the number shown is the
    // number of comments that happen. Anything routed to a person instead is
    // not one of them: it is waiting in the approval queue, not going out.
    if (decide(deps.policy, evaluateGuards(guards, candidate, guardContext)).kind === 'EXECUTE') {
      count += 1
    }
  }

  return { kind: 'READY', count, alreadyHandled, checkedAt: deps.nowMs }
}
