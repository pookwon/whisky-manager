import { evaluateGuards, type Guard } from '../shared/guards.js'
import { checkGates, dailyWindowStart, hasStaleBacklog } from '../shared/limits.js'
import type { Clock, Random } from '../shared/ports.js'
import { laterPostId } from '../shared/postId.js'
import { decide } from '../shared/policy.js'
import { TIMEOUTS, type ExtensionMessage, type PostRef } from '../shared/protocol.js'
import { isWithinActiveHours, nextActionDelayMs } from '../shared/schedule.js'
import { initialStatus, transition } from '../shared/statusMachine.js'
import type { ApprovalPolicy, Candidate, Limits } from '../shared/types.js'
import type { DedupeStore } from './db/dedupeStore.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'
import { sweepApprovals } from './approvals.js'
import { promoteRetries } from './retries.js'
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
  /**
   * Renders the text to post. Failure is a first-class outcome so a missing
   * variable becomes a risk flag the policy can act on, rather than a
   * half-filled comment.
   */
  readonly renderBody: (candidate: Candidate) => RenderOutcome
  readonly isEnabled: () => boolean
  readonly hasTemplate: () => boolean
  readonly isKilled: () => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly newRequestId: () => string
  readonly watermark: string | null
}

export type RenderOutcome =
  | { ok: true; templateId: string; body: string }
  | { ok: false; missing: string[] }

export type SessionRefusal =
  | 'KILLED'
  | 'DISABLED'
  | 'NO_TEMPLATE'
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

interface ExecutionJob {
  readonly executionId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly body: string
  readonly templateId: string | null
  readonly priorAttempts: number
}

type JobResult = 'EXECUTED' | 'SKIPPED' | 'EXPIRED' | 'FAILED' | 'RETRY' | 'STOP'

interface Counters {
  readonly dailyCount: number
  readonly sessionCount: number
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

async function collect(deps: SessionDeps) {
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
      { type: 'CHECK_COMMENTS', requestId: deps.newRequestId(), automationId: deps.automationId, action: post },
      TIMEOUTS.commentCheckMs,
    )
    return reply.type === 'COMMENTS' ? reply.authors : null
  } catch {
    return null
  }
}

async function execute(
  deps: SessionDeps,
  job: ExecutionJob,
): Promise<Extract<ExtensionMessage, { type: 'EXECUTED' }> | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'EXECUTE',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        action: { cafeId: job.cafeId, boardId: job.boardId, postId: job.postId, body: job.body },
      },
      TIMEOUTS.executeMs,
    )
    return reply.type === 'EXECUTED' ? reply : null
  } catch {
    return null
  }
}

/**
 * Everything from the gate to the recorded outcome, shared by backlog rows and
 * freshly collected candidates so both obey the same caps, pacing and re-check.
 */
async function runJob(deps: SessionDeps, job: ExecutionJob, counters: Counters): Promise<JobResult> {
  const gate = checkGates(
    { killed: deps.isKilled(), dailyCount: counters.dailyCount, sessionCount: counters.sessionCount },
    deps.limits,
  )
  if (!gate.allowed) {
    const now = deps.clock.now()
    if (gate.reason === 'SESSION_CAP_REACHED') {
      // Left QUEUED so the next session picks it up from the backlog.
      return 'STOP'
    }
    if (gate.reason === 'KILLED') {
      deps.repo.applyPatch(job.executionId, {
        status: transition('QUEUED', { type: 'KILLED' }, deps.limits),
        reason: 'KILLED',
        resolvedAt: now,
      })
      return 'STOP'
    }
    deps.repo.applyPatch(job.executionId, {
      status: transition('QUEUED', { type: 'DAILY_CAP_EXCEEDED' }, deps.limits),
      reason: 'DAILY_CAP_EXCEEDED',
      resolvedAt: now,
    })
    return 'EXPIRED'
  }

  await deps.sleep(nextActionDelayMs(deps.limits, deps.random))

  // The operator can hit the tray during the 8~25s wait. Checking only at the
  // gate would let that job through anyway.
  if (deps.isKilled()) {
    deps.repo.applyPatch(job.executionId, {
      status: transition('QUEUED', { type: 'KILLED' }, deps.limits),
      reason: 'KILLED',
      resolvedAt: deps.clock.now(),
    })
    return 'STOP'
  }

  // Re-check after the wait, not before: checking first leaves the whole
  // 8~25s window open for someone else to comment.
  const authorsNow = await recheckComments(deps, {
    cafeId: job.cafeId,
    boardId: job.boardId,
    postId: job.postId,
  })
  if (authorsNow === null) {
    deps.repo.applyPatch(job.executionId, {
      status: 'SKIPPED',
      reason: 'COMMENT_CHECK_FAILED',
      resolvedAt: deps.clock.now(),
    })
    return 'SKIPPED'
  }
  if (authorsNow.some((author) => deps.operatorAccounts.includes(author))) {
    deps.repo.applyPatch(job.executionId, {
      status: 'SKIPPED',
      reason: 'ALREADY_COMMENTED',
      resolvedAt: deps.clock.now(),
    })
    return 'SKIPPED'
  }

  const startedAt = deps.clock.now()
  const result = await execute(deps, job)
  const attempts = job.priorAttempts + 1
  const finishedAt = deps.clock.now()

  if (result !== null && result.ok) {
    deps.repo.applyPatch(job.executionId, {
      status: transition('QUEUED', { type: 'EXECUTION_SUCCEEDED' }, deps.limits),
      strategy: result.strategy,
      templateId: job.templateId,
      renderedText: job.body,
      attempts,
      executedAt: startedAt,
      resolvedAt: finishedAt,
    })
    return 'EXECUTED'
  }

  const nextStatus = transition('QUEUED', { type: 'EXECUTION_FAILED', attempts }, deps.limits)
  deps.repo.applyPatch(job.executionId, {
    status: nextStatus,
    templateId: job.templateId,
    renderedText: job.body,
    attempts,
    reason: result?.error ?? 'NO_REPLY',
    executedAt: startedAt,
    resolvedAt: nextStatus === 'FAILED' ? finishedAt : null,
  })
  return nextStatus === 'FAILED' ? 'FAILED' : 'RETRY'
}

export async function runSession(deps: SessionDeps): Promise<SessionOutcome> {
  if (deps.isKilled()) {
    return { opened: false, reason: 'KILLED' }
  }

  if (!deps.isEnabled()) {
    return { opened: false, reason: 'DISABLED' }
  }

  // Refusing loudly beats skipping every candidate: an operator who forgot to
  // register a template should see a reason, not silence.
  if (!deps.hasTemplate()) {
    return { opened: false, reason: 'NO_TEMPLATE' }
  }

  const openedAt = deps.clock.now()
  if (!isWithinActiveHours(openedAt, deps.limits, deps.clock)) {
    return { opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' }
  }

  const login = await checkLogin(deps)
  if (login === 'OUT') return { opened: false, reason: 'NOT_LOGGED_IN' }
  if (login === 'UNKNOWN') return { opened: false, reason: 'LOGIN_CHECK_FAILED' }

  // Maintenance runs before the brake on purpose. A stale RETRY_WAIT row would
  // otherwise trip the brake every session, and the sweep that retires it would
  // never get to run — a permanent deadlock.
  sweepApprovals(deps.repo, deps.automationId, deps.limits, openedAt)
  promoteRetries(deps.repo, deps.automationId, deps.limits, openedAt)

  const unresolved = deps.repo.listUnresolved(deps.automationId)
  if (hasStaleBacklog(unresolved.map((r) => ({ postedAt: r.targetPostedAt })), openedAt, deps.limits)) {
    return { opened: false, reason: 'STALE_BACKLOG' }
  }

  let executed = 0
  let skipped = 0
  let awaitingApproval = 0
  let failed = 0
  let expired = 0
  let lastProcessedPostId: string | null = null
  /** Requests actually sent this session. Caps count attempts, not successes. */
  let attempted = 0

  const dailyStart = dailyWindowStart(openedAt, deps.limits, deps.clock)
  let dailyCount = deps.repo.countExecutedSince(deps.automationId, dailyStart)

  const tally = (result: JobResult): void => {
    // EXECUTED, FAILED and RETRY all mean a request reached naver.
    if (result === 'EXECUTED' || result === 'FAILED' || result === 'RETRY') {
      attempted += 1
      dailyCount += 1
    }
    if (result === 'EXECUTED') {
      executed += 1
    } else if (result === 'SKIPPED') {
      skipped += 1
    } else if (result === 'EXPIRED') {
      expired += 1
    } else if (result === 'FAILED') {
      failed += 1
    }
  }

  const summary = (): SessionOutcome => ({
    opened: true,
    executed,
    skipped,
    awaitingApproval,
    failed,
    expired,
    lastProcessedPostId,
  })

  // Backlog first: rows revived from RETRY_WAIT or approved by an operator are
  // older than anything we are about to collect.
  for (const row of deps.repo.listQueued(deps.automationId)) {
    const result = await runJob(
      deps,
      {
        executionId: row.id,
        cafeId: row.cafeId,
        boardId: row.boardId,
        postId: row.targetPostId,
        body: row.renderedText,
        templateId: row.templateId,
        priorAttempts: row.attempts,
      },
      { dailyCount, sessionCount: attempted },
    )
    if (result === 'STOP') return summary()
    tally(result)
  }

  const raws = await collect(deps)
  if (raws === null) return { opened: false, reason: 'COLLECT_FAILED' }

  for (const raw of raws) {
    const now = deps.clock.now()

    // Advance per post handled, not once after collection: if the app dies
    // mid-session, a collection-time advance would skip everything in between.
    lastProcessedPostId = laterPostId(lastProcessedPostId, raw.postId)

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

    // Render before deciding so a failed substitution can raise a risk flag
    // and let the policy handle it, instead of being discovered too late.
    const rendered = deps.renderBody(candidate)
    const guardEvaluation = evaluateGuards(deps.guards, candidate, {
      nowMs: now,
      operatorAccounts: deps.operatorAccounts,
      existingCommentAuthors: raw.existingCommentAuthors,
    })
    const evaluation = rendered.ok
      ? guardEvaluation
      : {
          skip: guardEvaluation.skip,
          flags: [...guardEvaluation.flags, 'VARIABLE_EXTRACTION_FAILED' as const],
        }

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

    if (!rendered.ok) {
      // decide() must have routed an unrenderable candidate away from QUEUED.
      throw new Error(`cannot execute ${candidate.postId}: missing ${rendered.missing.join(', ')}`)
    }

    // Persist the decision and the text before executing, so a crash leaves a
    // row the next session can pick up from the backlog.
    deps.repo.applyPatch(executionId, {
      status: 'QUEUED',
      riskFlags: evaluation.flags,
      templateId: rendered.templateId,
      renderedText: rendered.body,
    })

    const result = await runJob(
      deps,
      {
        executionId,
        cafeId: candidate.cafeId,
        boardId: candidate.boardId,
        postId: candidate.postId,
        body: rendered.body,
        templateId: rendered.templateId,
        priorAttempts: 0,
      },
      { dailyCount, sessionCount: attempted },
    )
    if (result === 'STOP') break
    tally(result)
  }

  return summary()
}
