import { evaluateGuards, type Guard } from '../shared/guards.js'
import { checkGates, dailyWindowStart, hasStaleBacklog } from '../shared/limits.js'
import type { Clock, Random } from '../shared/ports.js'
import { laterPostId } from '../shared/postId.js'
import { decide } from '../shared/policy.js'
import { TIMEOUTS, type ExtensionMessage, type PostRef, type RawCandidate } from '../shared/protocol.js'
import { isWithinActiveHours, nextActionDelayMs } from '../shared/schedule.js'
import { initialStatus, transition } from '../shared/statusMachine.js'
import type { ApprovalPolicy, Candidate, Limits } from '../shared/types.js'
import type { DedupeStore } from './db/dedupeStore.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'
import type { ExtensionTransport } from './ws/server.js'

export interface SessionDeps {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly policy: ApprovalPolicy
  readonly limits: Limits
  readonly guards: readonly Guard[]
  readonly operatorAccounts: readonly string[]
  readonly clock: Clock
  readonly random: Random
  readonly transport: ExtensionTransport
  readonly dedupe: DedupeStore
  readonly repo: ExecutionsRepo
  readonly renderBody: (candidate: Candidate) => { templateId: string; body: string }
  readonly isKilled: () => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly newRequestId: () => string
  readonly watermark: string | null
}

export type SessionRefusal =
  | 'KILLED'
  | 'OUTSIDE_ACTIVE_HOURS'
  | 'NOT_LOGGED_IN'
  | 'LOGIN_CHECK_FAILED'
  | 'STALE_BACKLOG'
  | 'COLLECT_FAILED'

export type SessionOutcome =
  | { opened: false; reason: SessionRefusal }
  | {
      opened: true
      executed: number
      skipped: number
      awaitingApproval: number
      failed: number
      expired: number
      /** Furthest post this session finished handling, for the watermark. */
      lastProcessedPostId: string | null
    }

async function checkLogin(deps: SessionDeps): Promise<'IN' | 'OUT' | 'UNKNOWN'> {
  try {
    const reply = await deps.transport.request(
      { type: 'CHECK_LOGIN', requestId: deps.newRequestId() },
      TIMEOUTS.loginCheckMs,
    )
    if (reply.type !== 'LOGIN_STATE') return 'UNKNOWN'
    return reply.loggedIn ? 'IN' : 'OUT'
  } catch {
    return 'UNKNOWN'
  }
}

async function collect(deps: SessionDeps): Promise<RawCandidate[] | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'COLLECT',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        source: { cafeId: deps.cafeId, boardId: deps.boardId },
        sincePostId: deps.watermark,
      },
      TIMEOUTS.collectMs,
    )
    return reply.type === 'COLLECTED' ? reply.candidates : null
  } catch {
    return null
  }
}

/**
 * Re-reads the post's comments immediately before writing. Collection may be
 * seconds old, and in parallel operation with humans a staff member can get
 * there first. `null` means the check could not be performed.
 */
async function recheckComments(deps: SessionDeps, post: PostRef): Promise<string[] | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'CHECK_COMMENTS',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        action: post,
      },
      TIMEOUTS.commentCheckMs,
    )
    return reply.type === 'COMMENTS' ? reply.authors : null
  } catch {
    return null
  }
}

async function execute(
  deps: SessionDeps,
  candidate: Candidate,
  body: string,
): Promise<Extract<ExtensionMessage, { type: 'EXECUTED' }> | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'EXECUTE',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        action: {
          cafeId: candidate.cafeId,
          boardId: candidate.boardId,
          postId: candidate.postId,
          body,
        },
      },
      TIMEOUTS.executeMs,
    )
    return reply.type === 'EXECUTED' ? reply : null
  } catch {
    return null
  }
}

export async function runSession(deps: SessionDeps): Promise<SessionOutcome> {
  if (deps.isKilled()) {
    return { opened: false, reason: 'KILLED' }
  }

  const openedAt = deps.clock.now()
  if (!isWithinActiveHours(openedAt, deps.limits, deps.clock)) {
    return { opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' }
  }

  const login = await checkLogin(deps)
  if (login === 'OUT') return { opened: false, reason: 'NOT_LOGGED_IN' }
  if (login === 'UNKNOWN') return { opened: false, reason: 'LOGIN_CHECK_FAILED' }

  const unresolved = deps.repo.listUnresolved(deps.automationId)
  if (hasStaleBacklog(unresolved.map((r) => ({ postedAt: r.targetPostedAt })), openedAt, deps.limits)) {
    return { opened: false, reason: 'STALE_BACKLOG' }
  }

  const raws = await collect(deps)
  if (raws === null) return { opened: false, reason: 'COLLECT_FAILED' }

  let executed = 0
  let skipped = 0
  let awaitingApproval = 0
  let failed = 0
  let expired = 0
  let lastProcessedPostId: string | null = null

  const dailyStart = dailyWindowStart(openedAt, deps.limits, deps.clock)
  let dailyCount = deps.repo.countSuccessSince(deps.automationId, dailyStart)

  for (const raw of raws) {
    const now = deps.clock.now()

    const executionId = await deps.dedupe.claim({
      automationId: deps.automationId,
      cafeId: deps.cafeId,
      boardId: deps.boardId,
      postId: raw.postId,
      title: raw.title,
      authorNickname: raw.authorNickname,
      authorId: raw.authorId,
      postedAt: raw.postedAt,
      detectedAt: now,
    })
    // Advance per post handled, not once after collection: if the app dies
    // mid-session, a collection-time advance would skip everything in between.
    lastProcessedPostId = laterPostId(lastProcessedPostId, raw.postId)
    if (executionId === null) continue

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

    const evaluation = evaluateGuards(deps.guards, candidate, {
      nowMs: now,
      operatorAccounts: deps.operatorAccounts,
      existingCommentAuthors: raw.existingCommentAuthors,
    })
    const disposition = decide(deps.policy, evaluation)
    const status = initialStatus(disposition)

    if (status === 'SKIPPED') {
      deps.repo.applyPatch(executionId, {
        status,
        reason: disposition.kind === 'SKIP' ? disposition.reason : null,
        riskFlags: evaluation.flags,
        resolvedAt: now,
      })
      skipped += 1
      continue
    }

    if (status === 'AWAITING_APPROVAL') {
      deps.repo.applyPatch(executionId, { status, riskFlags: evaluation.flags })
      awaitingApproval += 1
      continue
    }

    const gate = checkGates({ killed: deps.isKilled(), dailyCount, sessionCount: executed }, deps.limits)
    if (!gate.allowed) {
      if (gate.reason === 'SESSION_CAP_REACHED') {
        deps.repo.applyPatch(executionId, { status: 'QUEUED', riskFlags: evaluation.flags })
        break
      }
      if (gate.reason === 'KILLED') {
        deps.repo.applyPatch(executionId, {
          status: transition('QUEUED', { type: 'KILLED' }, deps.limits),
          reason: 'KILLED',
          resolvedAt: now,
        })
        break
      }
      deps.repo.applyPatch(executionId, {
        status: transition('QUEUED', { type: 'DAILY_CAP_EXCEEDED' }, deps.limits),
        reason: 'DAILY_CAP_EXCEEDED',
        resolvedAt: now,
      })
      expired += 1
      continue
    }

    deps.repo.applyPatch(executionId, { status: 'QUEUED', riskFlags: evaluation.flags })
    await deps.sleep(nextActionDelayMs(deps.limits, deps.random))

    // Re-check after the wait, not before: checking first leaves the whole
    // 8~25s window open for someone else to comment.
    const post: PostRef = { cafeId: candidate.cafeId, boardId: candidate.boardId, postId: candidate.postId }
    const authorsNow = await recheckComments(deps, post)
    if (authorsNow === null) {
      deps.repo.applyPatch(executionId, {
        status: 'SKIPPED',
        reason: 'COMMENT_CHECK_FAILED',
        riskFlags: evaluation.flags,
        resolvedAt: deps.clock.now(),
      })
      skipped += 1
      continue
    }
    if (authorsNow.some((author) => deps.operatorAccounts.includes(author))) {
      deps.repo.applyPatch(executionId, {
        status: 'SKIPPED',
        reason: 'ALREADY_COMMENTED',
        riskFlags: evaluation.flags,
        resolvedAt: deps.clock.now(),
      })
      skipped += 1
      continue
    }

    const rendered = deps.renderBody(candidate)
    const startedAt = deps.clock.now()
    const result = await execute(deps, candidate, rendered.body)
    const attempts = 1
    const finishedAt = deps.clock.now()

    if (result !== null && result.ok) {
      deps.repo.applyPatch(executionId, {
        status: transition('QUEUED', { type: 'EXECUTION_SUCCEEDED' }, deps.limits),
        strategy: result.strategy,
        templateId: rendered.templateId,
        renderedText: rendered.body,
        attempts,
        executedAt: startedAt,
        resolvedAt: finishedAt,
      })
      executed += 1
      dailyCount += 1
      continue
    }

    const nextStatus = transition('QUEUED', { type: 'EXECUTION_FAILED', attempts }, deps.limits)
    deps.repo.applyPatch(executionId, {
      status: nextStatus,
      templateId: rendered.templateId,
      renderedText: rendered.body,
      attempts,
      reason: result?.error ?? 'NO_REPLY',
      executedAt: startedAt,
      resolvedAt: nextStatus === 'FAILED' ? finishedAt : null,
    })
    if (nextStatus === 'FAILED') failed += 1
  }

  return { opened: true, executed, skipped, awaitingApproval, failed, expired, lastProcessedPostId }
}
