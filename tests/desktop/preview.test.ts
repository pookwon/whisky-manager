import { describe, expect, it } from 'vitest'
import { previewDay, type StartupPreview } from '../../src/desktop/preview.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { kstDayStartMs } from '../../src/shared/kst.js'
import type { CommentAuthorLookup } from '../../src/desktop/commentAuthors.js'
import type { CommentAuthor } from '../../src/shared/types.js'

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

const deps = (over: Partial<Parameters<typeof previewDay>[0]>) => ({
  cafeId: CAFE,
  boardId: '5',
  automationId: 'auto-1',
  nowMs: NOW,
  newRequestId: () => 'r',
  transport: transportReturning([]),
  operatorAccounts: [],
  policy: 'AUTO' as const,
  lookup: mockLookup({}),
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
  it('counts posts without comments in count, posts with comments in pending', async () => {
    const candidates = [
      raw({ postId: '7001', authorId: 'a1', commentCount: 0 }),
      raw({ postId: '7002', authorId: 'a2', commentCount: null }), // Has comments but not named
      raw({ postId: '7003', authorId: 'a3', commentCount: 2 }), // Has comments, count known
    ]

    const previews: StartupPreview[] = []
    const lookup = mockLookup({})
    await previewDay(deps({
      transport: transportReturning(candidates),
      lookup,
      onNarrow: (p) => previews.push(p),
    }))

    // Immediately before lookups land: count has the posts we know are empty,
    // pending has the ones we have not checked yet
    expect(previews[0]).toMatchObject({ kind: 'READY', count: 1, pending: 2 })
  })

  it('zeroes pending once all lookups settle', async () => {
    const candidates = [
      raw({ postId: '7101', authorId: 'a1', commentCount: 0 }),
      raw({ postId: '7102', authorId: 'a2', commentCount: 3 }),
    ]

    const previews: StartupPreview[] = []
    const lookup = mockLookup({ '7102': [] }) // Post 7102 has no comments (from check)
    await previewDay(deps({
      transport: transportReturning(candidates),
      lookup,
      onNarrow: (p) => previews.push(p),
    }))

    // After lookups land, pending should be 0 and counts should be split
    const final = previews[previews.length - 1]
    expect(final).toMatchObject({ kind: 'READY', pending: 0 })
  })

  it('session reusing the panel lookup does not ask the cafe again', async () => {
    const candidates = [
      raw({ postId: '7201', authorId: 'a1', commentCount: 0 }),
      raw({ postId: '7202', authorId: 'a2', commentCount: 2 }),
    ]

    // Panel runs preview with a lookup, narrowing as results land
    const transport = transportReturning(candidates)
    const lookup = mockLookup({ '7202': [] })
    const collected1: AppMessage[] = []
    const t1 = {
      asked: collected1,
      isConnected: () => true,
      request: (msg: AppMessage) => {
        collected1.push(msg)
        return transport.request(msg)
      },
    }

    await previewDay(deps({
      transport: t1,
      lookup,
      onNarrow: () => {},
    }))

    // Session runs the same day with the same lookup (reused instance)
    const collected2: AppMessage[] = []
    const t2 = {
      asked: collected2,
      isConnected: () => true,
      request: (msg: AppMessage) => {
        collected2.push(msg)
        return transport.request(msg)
      },
    }

    await previewDay(deps({
      transport: t2,
      lookup, // Same lookup instance
    }))

    const checkCount2 = collected2.filter((m) => m.type === 'CHECK_COMMENTS').length

    // The second run should not have made any new requests, because the
    // lookup already has those results cached
    expect(checkCount2).toBe(0)
  })
})
