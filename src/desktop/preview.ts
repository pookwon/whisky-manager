import { evaluateGuards, operatorAlreadyCommentedGuard, type GuardContext } from '../shared/guards.js'
import { firstPostOnlyGuard } from '../shared/automations/welcome-comment/firstPost.js'
import { TIMEOUTS, type RawCandidate } from '../shared/protocol.js'
import { kstDayStartMs } from '../shared/kst.js'
import type { Candidate } from '../shared/types.js'
import { firstPostIdByAuthor } from './orchestrator.js'
import type { ExtensionTransport } from './ws/server.js'

export type StartupPreview =
  | { kind: 'READY'; count: number; checkedAt: number }
  | { kind: 'UNAVAILABLE'; reason: 'BRIDGE_OFFLINE' | 'READ_FAILED' }

export interface PreviewDeps {
  readonly transport: ExtensionTransport
  readonly cafeId: string
  readonly boardId: string
  readonly automationId: string
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

export async function previewToday(deps: PreviewDeps): Promise<StartupPreview> {
  if (!deps.transport.isConnected()) {
    return { kind: 'UNAVAILABLE', reason: 'BRIDGE_OFFLINE' }
  }

  const sincePostedAt = kstDayStartMs(deps.nowMs)
  const raws = await collect(deps.transport, deps.automationId, deps.cafeId, deps.boardId, deps.newRequestId, sincePostedAt)
  if (raws === null) {
    return { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
  }

  const firstPosts = firstPostIdByAuthor(raws)
  const guards = [operatorAlreadyCommentedGuard, firstPostOnlyGuard]
  let count = 0

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
      existingCommentAuthors: raw.existingCommentAuthors,
      isFirstPostByAuthor: raw.authorId !== null && firstPosts.get(raw.authorId) === raw.postId,
    }

    const evaluation = evaluateGuards(guards, candidate, guardContext)
    // Only count candidates that pass all guards (no skip)
    if (evaluation.skip === null) {
      count += 1
    }
  }

  return { kind: 'READY', count, checkedAt: deps.nowMs }
}
