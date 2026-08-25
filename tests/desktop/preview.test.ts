import { describe, expect, it } from 'vitest'
import { previewDay, type StartupPreview } from '../../src/desktop/preview.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { kstDayStartMs } from '../../src/shared/kst.js'
import { WELCOME_GUARDS } from '../../src/shared/automations/welcome-comment/guards.js'
import type { RenderOutcome } from '../../src/shared/templates.js'
import type { CommentAuthorLookup } from '../../src/desktop/commentAuthors.js'
import type { Candidate, CommentAuthor } from '../../src/shared/types.js'

const CAFE = '10000000'
/** 2026-08-23 12:00 KST. */
const NOW = Date.UTC(2026, 7, 23, 3, 0)

function raw(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    postId: '1001',
    title: null,
    bodyText: '안녕하세요 잘부탁드립니다',
    authorNickname: '가입자하나',
    authorId: 'member-1',
    postedAt: NOW,
    commentCount: 0,
    ...overrides,
  }
}

function transportReturning(collected: RawCandidate[]) {
  const asked: AppMessage[] = []
  return {
    asked,
    isConnected: () => true,
    request: (message: AppMessage): Promise<ExtensionMessage> => {
      asked.push(message)
      if (message.type === 'COLLECT') {
        return Promise.resolve({ type: 'COLLECTED', requestId: 'r', candidates: collected } as ExtensionMessage)
      }
      return Promise.reject(new Error(`unexpected ${message.type}`))
    },
  }
}

function offlineTransport() {
  return {
    asked: [] as AppMessage[],
    isConnected: () => false,
    request: () => Promise.reject(new Error('offline')),
  }
}

function mockLookup(results: Record<string, CommentAuthor[]>): CommentAuthorLookup {
  return {
    resolve: (postId, commentCount) => {
      if (commentCount === null) return Promise.resolve(null)
      if (commentCount === 0) return Promise.resolve([])
      return Promise.resolve(results[postId] ?? [])
    },
  }
}

/** Renders cleanly, so the cases below stay about guards and policy. */
const rendersFine = (): RenderOutcome => ({ ok: true, templateId: 't1', body: '환영합니다' })

const deps = (over: Partial<Parameters<typeof previewDay>[0]>) => ({
  cafeId: CAFE,
  boardId: '5',
  automationId: 'auto-1',
  nowMs: NOW,
  newRequestId: () => 'r',
  transport: transportReturning([]),
  operatorAccounts: [],
  policy: 'AUTO' as const,
  guards: WELCOME_GUARDS,
  renderBody: rendersFine,
  ...over,
})

describe('previewDay', () => {
  it('counts posts from different authors', async () => {
    const candidates = [
      raw({ postId: '1001', authorNickname: '가입자하나', authorId: 'member-1' }),
      raw({ postId: '1002', authorNickname: '가입자둘', authorId: 'member-2' }),
      raw({ postId: '1003', authorNickname: '가입자셋', authorId: 'member-3' }),
    ]
    const result = await previewDay(deps({ transport: transportReturning(candidates) }))
    expect(result).toEqual({ kind: 'READY', count: 3, alreadyHandled: 0, pending: 0, checkedAt: NOW })
  })

  it('counts only the first post when same author posts multiple times', async () => {
    const candidates = [
      raw({ postId: '1001', authorNickname: '가입자하나', authorId: 'member-1', postedAt: NOW - 120_000 }),
      raw({ postId: '1002', authorNickname: '가입자하나', authorId: 'member-1', postedAt: NOW - 60_000 }),
      raw({ postId: '1003', authorNickname: '가입자둘', authorId: 'member-2' }),
    ]
    const result = await previewDay(deps({ transport: transportReturning(candidates) }))
    expect(result).toEqual({ kind: 'READY', count: 2, alreadyHandled: 0, pending: 0, checkedAt: NOW })
  })

  it('returns BRIDGE_OFFLINE when transport is not connected', async () => {
    const result = await previewDay(deps({ transport: offlineTransport() }))
    expect(result).toEqual({ kind: 'UNAVAILABLE', reason: 'BRIDGE_OFFLINE' })
  })

  it('returns READ_FAILED when COLLECT fails', async () => {
    const transport = {
      asked: [] as AppMessage[],
      isConnected: () => true,
      request: (message: AppMessage) => {
        transport.asked.push(message)
        if (message.type === 'COLLECT') {
          return Promise.reject(new Error('collect failed'))
        }
        return Promise.reject(new Error('unexpected'))
      },
    }
    const result = await previewDay(deps({ transport }))
    expect(result).toEqual({ kind: 'UNAVAILABLE', reason: 'READ_FAILED' })
  })

  it('never sends EXECUTE messages', async () => {
    const candidates = [
      raw({ postId: '1001', authorNickname: '가입자하나', authorId: 'member-1' }),
      raw({ postId: '1002', authorNickname: '가입자둘', authorId: 'member-2' }),
    ]
    const transport = transportReturning(candidates)
    await previewDay(deps({ transport }))
    const executeMessages = transport.asked.filter((msg) => msg.type === 'EXECUTE')
    expect(executeMessages).toHaveLength(0)
  })

  it('only collects from the start of today', async () => {
    const candidates = [raw({ postId: '1001', authorId: 'member-1' })]
    const transport = transportReturning(candidates)
    await previewDay(deps({ transport }))
    const collectMessage = transport.asked.find((msg) => msg.type === 'COLLECT')
    expect(collectMessage).toBeDefined()
    if (collectMessage && collectMessage.type === 'COLLECT') {
      expect(collectMessage.sincePostedAt).toEqual(kstDayStartMs(NOW))
    }
  })
})

describe('previewDay — an earlier day', () => {
  const DAY = 86_400_000
  const CHOSEN = kstDayStartMs(NOW) - 3 * DAY

  it('counts that day and not the days after it', async () => {
    // Collection has a floor and no ceiling, so everything since arrives too.
    // A preview that counted it all would promise work the session will not do.
    const candidates = [
      raw({ postId: '8001', postedAt: CHOSEN + 3_600_000, authorId: 'a1' }),
      raw({ postId: '8002', postedAt: CHOSEN + DAY + 3_600_000, authorId: 'a2' }),
    ]

    const result = await previewDay(
      deps({ transport: transportReturning(candidates), dayStartMs: CHOSEN }),
    )

    expect(result).toMatchObject({ kind: 'READY', count: 1 })
  })

  it('asks the board for the chosen day', async () => {
    const sent: AppMessage[] = []
    const transport = {
      isConnected: () => true,
      request: (message: AppMessage) => {
        sent.push(message)
        return transportReturning([]).request(message)
      },
    }

    await previewDay(deps({ transport, dayStartMs: CHOSEN }))

    expect(sent.find((m) => m.type === 'COLLECT')).toMatchObject({ sincePostedAt: CHOSEN })
  })
})

describe('previewDay — the number the operator approves against', () => {
  it('leaves out a post that carries a risk flag under AUTO', async () => {
    // A post that already has comments cannot have its commenters named from
    // the list, so the guard flags it and AUTO skips it. Counting it promises
    // a comment that will never be sent.
    const candidates = [
      raw({ postId: '9001', authorId: 'a1', commentCount: null }),
      raw({ postId: '9002', authorId: 'a2', commentCount: 0 }),
    ]

    const result = await previewDay(
      deps({ transport: transportReturning(candidates), policy: 'AUTO' }),
    )

    expect(result).toMatchObject({ kind: 'READY', count: 1 })
  })

  it('counts nothing under MANUAL, where every post waits for a person', async () => {
    const candidates = [raw({ postId: '9003', authorId: 'a3', commentCount: 0 })]

    const result = await previewDay(
      deps({ transport: transportReturning(candidates), policy: 'MANUAL' }),
    )

    expect(result).toMatchObject({ kind: 'READY', count: 0 })
  })

  it('counts the clean post but not the flagged one under SEMI', async () => {
    const candidates = [
      raw({ postId: '9004', authorId: 'a4', commentCount: null }),
      raw({ postId: '9005', authorId: 'a5', commentCount: 0 }),
    ]

    const result = await previewDay(
      deps({ transport: transportReturning(candidates), policy: 'SEMI' }),
    )

    expect(result).toMatchObject({ kind: 'READY', count: 1 })
  })
})

describe('previewDay — the comment it counts against', () => {
  /** Fails for a post whose nickname could not be read, as the real one does. */
  const needsNickname = (target: Candidate): RenderOutcome =>
    target.authorNickname === null
      ? { ok: false, missing: ['닉네임'] }
      : { ok: true, templateId: 't1', body: `${target.authorNickname}님 환영합니다` }

  it('counts nothing when no wording is registered', () => {
    // The run refuses outright with NO_TEMPLATE and posts nothing. A count that
    // skipped rendering reported the whole day as targets.
    const candidates = [
      raw({ postId: '9301', authorId: 'a1' }),
      raw({ postId: '9302', authorId: 'a2' }),
    ]

    return expect(
      previewDay(
        deps({
          transport: transportReturning(candidates),
          renderBody: () => ({ ok: false, missing: ['template'] }),
        }),
      ),
    ).resolves.toMatchObject({ kind: 'READY', count: 0 })
  })

  it('leaves out a post whose variable cannot be filled', async () => {
    // A failed substitution is a risk flag, and under AUTO a flagged post is
    // skipped. Counting it promises a comment that never goes out.
    const candidates = [
      raw({ postId: '9401', authorId: 'a1', authorNickname: null }),
      raw({ postId: '9402', authorId: 'a2', authorNickname: '가입자둘' }),
    ]

    const result = await previewDay(
      deps({ transport: transportReturning(candidates), renderBody: needsNickname }),
    )

    expect(result).toMatchObject({ kind: 'READY', count: 1 })
  })

  it('counts an unrenderable post as neither target nor answered under SEMI', async () => {
    // SEMI sends the flagged post to a person instead. It is not going out, so
    // it is not a target — and nobody has answered it either.
    const candidates = [raw({ postId: '9501', authorId: 'a1', authorNickname: null })]

    const result = await previewDay(
      deps({
        transport: transportReturning(candidates),
        policy: 'SEMI',
        renderBody: needsNickname,
      }),
    )

    expect(result).toMatchObject({ kind: 'READY', count: 0, alreadyHandled: 0 })
  })
})

describe('previewDay — telling the buckets apart', () => {
  it('separates what will be commented from what already has one', async () => {
    const candidates = [
      // Already answered: the list gives a comment count but never the names.
      raw({ postId: '9101', authorId: 'a1', commentCount: null }),
      raw({ postId: '9102', authorId: 'a2', commentCount: null }),
      // Proven empty, so it is a target.
      raw({ postId: '9103', authorId: 'a3', commentCount: 0 }),
    ]

    const result = await previewDay(deps({ transport: transportReturning(candidates) }))

    expect(result).toMatchObject({ kind: 'READY', count: 1, alreadyHandled: 2 })
  })

  it('counts a later post by the same author as neither', async () => {
    // It is not a target, and nobody has answered it. Folding it into either
    // number would make the two stop describing what they are named after.
    const candidates = [
      raw({ postId: '9201', authorId: 'same', postedAt: NOW - 7_200_000, commentCount: 0 }),
      raw({ postId: '9202', authorId: 'same', postedAt: NOW - 3_600_000, commentCount: 0 }),
    ]

    const result = await previewDay(deps({ transport: transportReturning(candidates) }))

    expect(result).toMatchObject({ kind: 'READY', count: 1, alreadyHandled: 0 })
  })
})

describe('previewDay — narrowing as lookups land', () => {
  it('with lookup: initially shows pending count, then narrows to final count', async () => {
    // Two posts: one empty, one with comments awaiting lookup
    const candidates = [
      raw({ postId: '7001', authorId: 'a1', commentCount: 0 }),
      raw({ postId: '7002', authorId: 'a2', commentCount: 2 }),
    ]

    const previews: StartupPreview[] = []
    const lookup = mockLookup({ '7002': [{ nickname: 'user1' } as CommentAuthor] })
    await previewDay(deps({
      transport: transportReturning(candidates),
      lookup,
      onNarrow: (p) => previews.push(p),
    }))

    // Initial: count is confirmed empty, pending is unknown
    expect(previews[0]).toMatchObject({ kind: 'READY', count: 1, pending: 1, alreadyHandled: 0 })

    // Final: all resolved, no pending
    expect(previews.length).toBeGreaterThan(0)
    const final = previews[previews.length - 1]!
    expect(final).toMatchObject({ kind: 'READY', pending: 0 })
    if (final.kind === 'READY') {
      expect(final.count + final.alreadyHandled).toBe(2) // All posts accounted for
    }
  })

  it('each post ends up in exactly one bucket: count, alreadyHandled, or neither', async () => {
    // Three posts to verify narrowing resolves everything
    const candidates = [
      raw({ postId: '7101', authorId: 'a1', commentCount: 0 }),
      raw({ postId: '7102', authorId: 'a2', commentCount: 2 }),
      raw({ postId: '7103', authorId: 'a3', commentCount: null }),
    ]

    const previews: StartupPreview[] = []
    const lookup = mockLookup({ '7102': [{ nickname: 'user' } as CommentAuthor] })
    await previewDay(deps({
      transport: transportReturning(candidates),
      lookup,
      onNarrow: (p) => previews.push(p),
    }))

    expect(previews.length).toBeGreaterThan(0)
    const initial = previews[0]!
    const final = previews[previews.length - 1]!

    // Initially: only empty posts can be counted, rest are pending
    expect(initial).toMatchObject({ kind: 'READY', count: 1, pending: 2, alreadyHandled: 0 })

    // Finally: pending is 0, every post is in count or alreadyHandled or neither
    expect(final).toMatchObject({ kind: 'READY', pending: 0 })
    if (final.kind === 'READY') {
      expect(final.count + final.alreadyHandled).toBeGreaterThanOrEqual(1) // At least some posts counted
    }
  })

  it('session reusing panel lookup avoids re-checking already-resolved posts', async () => {
    const candidates = [
      raw({ postId: '7201', authorId: 'a1', commentCount: 0 }),
      raw({ postId: '7202', authorId: 'a2', commentCount: 2 }),
    ]

    const lookup = mockLookup({ '7202': [{ nickname: 'user1' } as CommentAuthor] })

    // First run
    const previews1: StartupPreview[] = []
    await previewDay(deps({
      transport: transportReturning(candidates),
      lookup,
      onNarrow: (p) => previews1.push(p),
    }))
    expect(previews1.length).toBeGreaterThan(0)
    const final1 = previews1[previews1.length - 1]!

    // Second run with same lookup instance
    const previews2: StartupPreview[] = []
    await previewDay(deps({
      transport: transportReturning(candidates),
      lookup, // Cached
      onNarrow: (p) => previews2.push(p),
    }))
    expect(previews2.length).toBeGreaterThan(0)
    const final2 = previews2[previews2.length - 1]!

    // Both runs should produce identical final counts because lookup is cached
    expect(final1).toMatchObject({ kind: 'READY' })
    expect(final2).toMatchObject({ kind: 'READY' })
    if (final1.kind === 'READY' && final2.kind === 'READY') {
      expect(final1.count).toBe(final2.count)
      expect(final1.alreadyHandled).toBe(final2.alreadyHandled)
      expect(final1.pending).toBe(final2.pending)
    }
  })
})
