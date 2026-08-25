import { containsOperator, type Guard } from '../shared/guards.js'
import { RATE_WINDOW_MS, checkGates, hasStaleBacklog } from '../shared/limits.js'
import type { Clock, Random } from '../shared/ports.js'
import { TIMEOUTS, type ExtensionMessage, type PostRef } from '../shared/protocol.js'
import { isWithinActiveHours, nextActionDelayMs } from '../shared/schedule.js'
import { firstPostIdByAuthor, screenCandidate, type ScreeningContext } from '../shared/screening.js'
import { initialStatus, transition } from '../shared/statusMachine.js'
import type { RenderOutcome } from '../shared/templates.js'
import type { ApprovalPolicy, Candidate, CommentAuthor, Limits, RunMode } from '../shared/types.js'
import type { CommentAuthorLookup } from './commentAuthors.js'
import type { DedupeStore } from './db/dedupeStore.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'
import { sweepApprovals } from './approvals.js'
import { collectDay } from './collection.js'
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
  /** Resolves who commented on a post. Consulted only for posts about to be judged. */
  readonly commentAuthors: CommentAuthorLookup
  /**
   * Who asked for this session. A forced run is an operator who was shown what
   * they were overriding and chose to go ahead, so it passes the operating
   * window, the caps and the backlog brake — but never the kill switch.
   */
  readonly runMode: RunMode
  /**
   * Midnight KST of the day to work. Defaults to the day the session opens.
   * Filling in an earlier day is the same rule applied to a different day, not
   * a different rule.
   */
  readonly dayStartMs?: number
  /** Reports what the session is doing. Nothing about a run depends on anyone listening. */
  readonly onProgress?: (progress: SessionProgress) => void
}

export type SessionRefusal =
  | 'FUTURE_DAY'
  | 'NOT_CONFIGURED'
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
    }

interface PostWalk {
  /** Posts finished, not counting the one in hand. */
  readonly done: number
  readonly total: number
  readonly nickname: string | null
}

/**
 * What the session is doing right now. Most of a run's wall clock is the 8~25s
 * gap between comments, so "still going" is not enough: an operator watching
 * the dashboard needs to see the count move and whose post is in hand.
 *
 * The backlog and the fresh collection are separate walks because their sizes
 * become known at different moments. Reporting them as one would mean a total
 * that grows halfway through, which reads as a miscount rather than as the two
 * lists it is.
 */
export type SessionProgress =
  | { readonly phase: 'COLLECTING'; readonly pagesRead?: number; readonly collected?: number }
  | ({ readonly phase: 'BACKLOG' } & PostWalk)
  | ({ readonly phase: 'WORKING' } & PostWalk)

interface ExecutionJob {
  readonly executionId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly body: string
  readonly templateId: string | null
  readonly priorAttempts: number
}

type JobResult = 'EXECUTED' | 'SKIPPED' | 'FAILED' | 'RETRY' | 'STOP'

/**
 * What the cafe has heard from us in the hour ending now. Read fresh at every
 * gate rather than carried along: a session can run for the better part of an
 * hour, and by its end the requests it opened with have left the window.
 */
function sentWithinTheHour(deps: SessionDeps, nowMs: number): number {
  return deps.repo.countExecutedSince(deps.automationId, nowMs - RATE_WINDOW_MS)
}


async function checkLogin(deps: SessionDeps): Promise<'IN' | 'OUT' | 'UNKNOWN'> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'CHECK_LOGIN',
        requestId: deps.newRequestId(),
        source: { cafeId: deps.cafeId, boardId: deps.boardId },
      },
      TIMEOUTS.loginCheckMs,
    )
    if (reply.type !== 'LOGIN_STATE') return 'UNKNOWN'
    return reply.loggedIn ? 'IN' : 'OUT'
  } catch {
    return 'UNKNOWN'
  }
}

/**
 * Re-reads the post's comments immediately before writing. Collection may be
 * seconds old, and in parallel operation with humans a staff member can get
 * there first. `null` means the check could not be performed.
 */
async function recheckComments(deps: SessionDeps, post: PostRef): Promise<CommentAuthor[] | null> {
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
async function runJob(deps: SessionDeps, job: ExecutionJob, sessionCount: number): Promise<JobResult> {
  const now = deps.clock.now()
  const gate = checkGates(
    { killed: deps.isKilled(), hourlyCount: sentWithinTheHour(deps, now), sessionCount },
    deps.limits,
    deps.runMode,
  )
  if (!gate.allowed) {
    if (gate.reason === 'KILLED') {
      deps.repo.applyPatch(job.executionId, {
        status: transition('QUEUED', { type: 'KILLED' }, deps.limits),
        reason: 'KILLED',
        resolvedAt: now,
      })
      return 'STOP'
    }
    // Either cap leaves the row QUEUED for the next session. Neither is a
    // verdict on the post: the hour moves on, and a session that ran out of
    // room says nothing about whether the greeting deserves an answer.
    return 'STOP'
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
  if (containsOperator(authorsNow, deps.operatorAccounts)) {
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
  const forced = deps.runMode === 'FORCED'
  if (!forced && !isWithinActiveHours(openedAt, deps.limits, deps.clock)) {
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

  // The brake reads a days-old backlog as a sign something is broken and stops.
  // A forced run is an operator saying they have looked and want it to go
  // anyway; the schedule can never make that call for itself.
  const unresolved = deps.repo.listUnresolved(deps.automationId)
  if (!forced && hasStaleBacklog(unresolved.map((r) => ({ postedAt: r.targetPostedAt })), openedAt, deps.limits)) {
    return { opened: false, reason: 'STALE_BACKLOG' }
  }

  let executed = 0
  let skipped = 0
  let awaitingApproval = 0
  let failed = 0
  /** Requests actually sent this session. Caps count attempts, not successes. */
  let attempted = 0

  const tally = (result: JobResult): void => {
    // EXECUTED, FAILED and RETRY all mean a request reached naver.
    if (result === 'EXECUTED' || result === 'FAILED' || result === 'RETRY') {
      attempted += 1
    }
    if (result === 'EXECUTED') {
      executed += 1
    } else if (result === 'SKIPPED') {
      skipped += 1
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
  })

  // Backlog first: rows revived from RETRY_WAIT or approved by an operator are
  // older than anything we are about to collect.
  const queued = deps.repo.listQueued(deps.automationId)

  // Indexes rather than a counter: every `continue` below would be a chance for
  // a hand-kept tally to drift away from where the walk actually is.
  for (const [index, row] of queued.entries()) {
    deps.onProgress?.({
      phase: 'BACKLOG',
      done: index,
      total: queued.length,
      nickname: row.targetAuthor,
    })
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
      attempted,
    )
    if (result === 'STOP') return summary()
    tally(result)
  }

  // The whole day, every session. A post passed over earlier has to come back
  // into view, because what disqualified it can change on the cafe's side.
  deps.onProgress?.({ phase: 'COLLECTING' })
  const raws = await collectDay({
    transport: deps.transport,
    automationId: deps.automationId,
    source: { cafeId: deps.cafeId, boardId: deps.boardId },
    newRequestId: deps.newRequestId,
    dayStartMs: deps.dayStartMs ?? openedAt,
    onProgress: (pagesRead, collected) =>
      deps.onProgress?.({ phase: 'COLLECTING', pagesRead, collected }),
  })
  if (raws === null) return { opened: false, reason: 'COLLECT_FAILED' }

  // Fixed for the whole walk, and the same context the count shown before this
  // run was reached through.
  const screening: ScreeningContext = {
    automationId: deps.automationId,
    source: { cafeId: deps.cafeId, boardId: deps.boardId },
    policy: deps.policy,
    guards: deps.guards,
    operatorAccounts: deps.operatorAccounts,
    firstPosts: firstPostIdByAuthor(raws),
    renderBody: deps.renderBody,
  }

  for (const [index, raw] of raws.entries()) {
    deps.onProgress?.({
      phase: 'WORKING',
      done: index,
      total: raws.length,
      nickname: raw.authorNickname,
    })

    // Ahead of the claim so a post past the cap costs neither a row nor a
    // lookup. runJob checks again for the backlog walk, which does not come
    // through here.
    const gate = checkGates(
      { killed: deps.isKilled(), hourlyCount: sentWithinTheHour(deps, deps.clock.now()), sessionCount: attempted },
      deps.limits,
      deps.runMode,
    )
    if (!gate.allowed) {
      break
    }

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
    if (executionId === null) continue

    const existingCommentAuthors = await deps.commentAuthors.resolve(raw.postId, raw.commentCount)
    const { candidate, evaluation, disposition, rendered } = screenCandidate(raw, screening, {
      nowMs: now,
      existingCommentAuthors,
    })
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
      attempted,
    )
    if (result === 'STOP') break
    tally(result)
  }

  return summary()
}
