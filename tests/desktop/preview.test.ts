import { describe, expect, it } from 'vitest'
import { previewToday } from '../../src/desktop/preview.js'
import type { MembersRepo } from '../../src/desktop/db/membersRepo.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import type { RawMember } from '../../src/shared/members.js'

const CAFE = '10000000'
/** 2026-08-23 12:00 KST. */
const NOW = Date.UTC(2026, 7, 23, 3, 0)

const autoGreeting = (nickname: string): string =>
  `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.`

function raw(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    postId: '1001',
    title: null,
    bodyText: '안녕하세요 잘부탁드립니다',
    authorNickname: '가입자하나',
    authorId: 'member-1',
    postedAt: NOW,
    existingCommentAuthors: [],
    ...overrides,
  }
}

function fakeRepo(seed: Record<string, string> = {}): MembersRepo & { rows: Map<string, string> } {
  const rows = new Map(Object.entries(seed))
  return {
    rows,
    joinDateOf: (_cafeId, memberKey) => rows.get(memberKey) ?? null,
    upsertMany: (_cafeId, batch) => {
      for (const m of batch) rows.set(m.memberKey, m.joinDate)
    },
    isEmpty: () => rows.size === 0,
    prune: (_cafeId, oldest) => {
      for (const [key, date] of rows) if (date < oldest) rows.delete(key)
    },
  }
}

function transportReturning(collected: RawCandidate[], memberPages: (RawMember[] | null)[] = [[]]) {
  const asked: AppMessage[] = []
  return {
    asked,
    isConnected: () => true,
    request: (message: AppMessage): Promise<ExtensionMessage> => {
      asked.push(message)
      if (message.type === 'COLLECT') {
        return Promise.resolve({ type: 'COLLECTED', requestId: 'r', candidates: collected } as ExtensionMessage)
      }
      const page = message.type === 'FETCH_MEMBERS' ? message.page : 1
      const members = memberPages[page - 1] ?? []
      return Promise.resolve({ type: 'MEMBERS', requestId: 'r', members } as ExtensionMessage)
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

const deps = (over: Partial<Parameters<typeof previewToday>[0]>) => ({
  cafeId: CAFE,
  boardId: '5',
  automationId: 'auto-1',
  windowDays: 7,
  nowMs: NOW,
  newRequestId: () => 'r',
  repo: fakeRepo(),
  transport: transportReturning([], [[]]),
  operatorAccounts: [],
  ...over,
})

describe('previewToday', () => {
  it('counts 3 auto-generated greeting posts', async () => {
    const candidates = [
      raw({ postId: '1001', bodyText: autoGreeting('가입자하나'), authorNickname: '가입자하나', authorId: 'member-1' }),
      raw({ postId: '1002', bodyText: autoGreeting('가입자둘'), authorNickname: '가입자둘', authorId: 'member-2' }),
      raw({ postId: '1003', bodyText: autoGreeting('가입자셋'), authorNickname: '가입자셋', authorId: 'member-3' }),
    ]
    const result = await previewToday(deps({ transport: transportReturning(candidates, [[]]) }))
    expect(result).toEqual({ kind: 'READY', count: 3, checkedAt: NOW })
  })

  it('skips an old member not in the table', async () => {
    const candidates = [
      raw({ postId: '1001', bodyText: autoGreeting('가입자하나'), authorNickname: '가입자하나', authorId: 'member-1' }),
      // This one joined long ago and is not in the table, so resolved as NOT_TRACKED
      raw({ postId: '1002', bodyText: '게시글입니다', authorId: 'member-old', authorNickname: '오래된회원' }),
      raw({ postId: '1003', bodyText: autoGreeting('가입자셋'), authorNickname: '가입자셋', authorId: 'member-3' }),
    ]
    const result = await previewToday(deps({ transport: transportReturning(candidates, [[]]) }))
    // Only the 2 auto-generated ones count; the old member's post is skipped
    expect(result).toEqual({ kind: 'READY', count: 2, checkedAt: NOW })
  })

  it('returns BRIDGE_OFFLINE when transport is not connected', async () => {
    const result = await previewToday(deps({ transport: offlineTransport() }))
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
        return Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: [] } as ExtensionMessage)
      },
    }
    const result = await previewToday(deps({ transport }))
    expect(result).toEqual({ kind: 'UNAVAILABLE', reason: 'READ_FAILED' })
  })

  it('counts auto-generated posts when member list fails, skipping deferred', async () => {
    const candidates = [
      raw({ postId: '1001', bodyText: autoGreeting('가입자하나'), authorNickname: '가입자하나', authorId: 'member-1' }),
      // This one is deferred because member lookup failed and it's not auto-generated
      raw({ postId: '1002', bodyText: '자기글입니다', authorId: 'member-unknown', authorNickname: '미추적회원' }),
      raw({ postId: '1003', bodyText: autoGreeting('가입자셋'), authorNickname: '가입자셋', authorId: 'member-3' }),
    ]
    const transport = {
      asked: [] as AppMessage[],
      isConnected: () => true,
      request: (message: AppMessage) => {
        transport.asked.push(message)
        if (message.type === 'COLLECT') {
          return Promise.resolve({
            type: 'COLLECTED',
            requestId: 'r',
            candidates,
          } as ExtensionMessage)
        }
        // Member list fails
        return Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage)
      },
    }
    const result = await previewToday(deps({ transport, repo: fakeRepo() }))
    // Only auto-generated ones count; deferred posts don't count
    expect(result).toEqual({ kind: 'READY', count: 2, checkedAt: NOW })
  })

  it('never sends EXECUTE messages', async () => {
    const candidates = [
      raw({ postId: '1001', bodyText: autoGreeting('가입자하나'), authorNickname: '가입자하나', authorId: 'member-1' }),
      raw({ postId: '1002', bodyText: autoGreeting('가입자둘'), authorNickname: '가입자둘', authorId: 'member-2' }),
    ]
    const transport = transportReturning(candidates, [[]])
    await previewToday(deps({ transport }))
    const executeMessages = transport.asked.filter((msg) => msg.type === 'EXECUTE')
    expect(executeMessages).toHaveLength(0)
  })
})
