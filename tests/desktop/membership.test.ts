import { describe, expect, it } from 'vitest'
import { createMembershipResolver } from '../../src/desktop/membership.js'
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

/** An in-memory stand-in with the same contract as the sqlite repo. */
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

function transportReturning(pages: (RawMember[] | null)[]) {
  const asked: AppMessage[] = []
  return {
    asked,
    isConnected: () => true,
    request: (message: AppMessage): Promise<ExtensionMessage> => {
      asked.push(message)
      const page = message.type === 'FETCH_MEMBERS' ? message.page : 1
      const members = pages[page - 1] ?? []
      return Promise.resolve({ type: 'MEMBERS', requestId: 'r', members } as ExtensionMessage)
    },
  }
}

const deps = (over: Partial<Parameters<typeof createMembershipResolver>[0]>) => ({
  cafeId: CAFE,
  windowDays: 7,
  nowMs: NOW,
  newRequestId: () => 'r',
  repo: fakeRepo(),
  transport: transportReturning([[]]),
  ...over,
})

describe('createMembershipResolver', () => {
  it('reads only one page on the very first run', async () => {
    const transport = transportReturning([
      [{ memberKey: 'member-1', joinDate: '2026.08.23.' }],
      [{ memberKey: 'member-9', joinDate: '2026.08.22.' }],
    ])
    await createMembershipResolver(deps({ transport, repo: fakeRepo() }))
    expect(transport.asked).toHaveLength(1)
  })

  it('stops once a page holds a member it already knows', async () => {
    const transport = transportReturning([
      [{ memberKey: 'known', joinDate: '2026.08.23.' }],
      [{ memberKey: 'member-9', joinDate: '2026.08.22.' }],
    ])
    await createMembershipResolver(deps({ transport, repo: fakeRepo({ known: '2026.08.23.' }) }))
    expect(transport.asked).toHaveLength(1)
  })

  it('keeps paging while every member on the page is new', async () => {
    const transport = transportReturning([
      [{ memberKey: 'a', joinDate: '2026.08.23.' }],
      [{ memberKey: 'known', joinDate: '2026.08.22.' }],
    ])
    await createMembershipResolver(deps({ transport, repo: fakeRepo({ known: '2026.08.22.' }) }))
    expect(transport.asked).toHaveLength(2)
  })

  it('reports the join date it stored', async () => {
    const repo = fakeRepo({ 'member-1': '2026.08.20.' })
    const resolve = await createMembershipResolver(deps({ repo }))
    expect(resolve(raw())).toEqual({ kind: 'JOINED', joinDate: '2026.08.20.' })
  })

  it('calls a member the table never saw not tracked', async () => {
    const resolve = await createMembershipResolver(deps({ repo: fakeRepo({ other: '2026.08.23.' }) }))
    expect(resolve(raw())).toEqual({ kind: 'NOT_TRACKED' })
  })

  it('defers a self-written greeting when the refresh failed', async () => {
    const transport = {
      isConnected: () => true,
      request: () => Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage),
    }
    const resolve = await createMembershipResolver(deps({ transport, repo: fakeRepo({ x: '2026.08.23.' }) }))
    expect(resolve(raw())).toBe('DEFER')
  })

  it('never defers an auto-generated post, because it needs no lookup', async () => {
    const transport = {
      isConnected: () => true,
      request: () => Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage),
    }
    const resolve = await createMembershipResolver(deps({ transport, repo: fakeRepo({ x: '2026.08.23.' }) }))
    expect(resolve(raw({ bodyText: autoGreeting('가입자하나') }))).toEqual({ kind: 'NOT_TRACKED' })
  })

  it('prunes members older than the window plus a day', async () => {
    const repo = fakeRepo({ stale: '2026.08.14.', edge: '2026.08.15.', fresh: '2026.08.23.' })
    await createMembershipResolver(deps({ repo }))
    expect(repo.rows.has('stale')).toBe(false)
    expect(repo.rows.has('edge')).toBe(true)
    expect(repo.rows.has('fresh')).toBe(true)
  })

  it('does not prune when the refresh failed', async () => {
    const transport = {
      isConnected: () => true,
      request: () => Promise.resolve({ type: 'MEMBERS', requestId: 'r', members: null } as ExtensionMessage),
    }
    const repo = fakeRepo({ stale: '2026.08.01.' })
    await createMembershipResolver(deps({ transport, repo }))
    expect(repo.rows.has('stale')).toBe(true)
  })
})
