import { evaluateGuards, operatorAlreadyCommentedGuard, type GuardContext } from '../shared/guards.js'
import { newMemberGuard } from '../shared/automations/welcome-comment/newMember.js'
import { TIMEOUTS, type RawCandidate } from '../shared/protocol.js'
import type { Candidate } from '../shared/types.js'
import type { MembersRepo } from './db/membersRepo.js'
import { createMembershipResolver } from './membership.js'
import type { ExtensionTransport } from './ws/server.js'

export type StartupPreview =
  | { kind: 'READY'; count: number; checkedAt: number }
  | { kind: 'UNAVAILABLE'; reason: 'BRIDGE_OFFLINE' | 'READ_FAILED' }

export interface PreviewDeps {
  readonly transport: ExtensionTransport
  readonly repo: MembersRepo
  readonly cafeId: string
  readonly boardId: string
  readonly automationId: string
  readonly windowDays: number
  readonly nowMs: number
  readonly newRequestId: () => string
  readonly operatorAccounts: readonly string[]
}

async function collect(
  transport: ExtensionTransport,
  automationId: string,
  cafeId: string,
  boardId: string,
  newRequestId: () => string,
): Promise<RawCandidate[] | null> {
  try {
    const reply = await transport.request(
      {
        type: 'COLLECT',
        requestId: newRequestId(),
        automationId,
        source: { cafeId, boardId },
        sincePostId: null,
      },
      TIMEOUTS.collectMs,
    )
    return reply.type === 'COLLECTED' ? reply.candidates : null
  } catch {
    return null
  }
}

export async function previewToday(deps: PreviewDeps): Promise<StartupPreview> {
  if (!deps.transport.isConnected()) {
    return { kind: 'UNAVAILABLE', reason: 'BRIDGE_OFFLINE' }
  }

  const raws = await collect(deps.transport, deps.automationId, deps.cafeId, deps.boardId, deps.newRequestId)
  if (raws === null) {
    return { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
  }

  const resolveMembership = await createMembershipResolver({
    transport: deps.transport,
    repo: deps.repo,
    cafeId: deps.cafeId,
    windowDays: deps.windowDays,
    nowMs: deps.nowMs,
    newRequestId: deps.newRequestId,
  })

  const guards = [operatorAlreadyCommentedGuard, newMemberGuard]
  let count = 0

  for (const raw of raws) {
    const membership = resolveMembership(raw)
    // DEFER candidates cannot be judged this session, so they don't count
    if (membership === 'DEFER') {
      continue
    }

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
      existingCommentAuthors: raw.existingCommentAuthors,
      authorMembership: membership,
      newMemberWindowDays: deps.windowDays,
    }

    const evaluation = evaluateGuards(guards, candidate, guardContext)
    // Only count candidates that pass all guards (no skip)
    if (evaluation.skip === null) {
      count += 1
    }
  }

  return { kind: 'READY', count, checkedAt: deps.nowMs }
}
