import { describe, expect, it } from 'vitest'
import { createJoinPatternSearch } from '../../src/desktop/joinPatternSearch.js'
import type { ExtensionTransport } from '../../src/desktop/ws/server.js'
import type { AppMessage, ExtensionMessage } from '../../src/shared/protocol.js'
import type { StudioJoinMember } from '../../src/shared/studioJoinList.js'

const member = (key: string, answers: readonly string[]): StudioJoinMember => ({
  memberKey: key,
  memberTag: key,
  nickname: key,
  maskedMemberId: 'a***',
  joinedAt: `2026-10-${key}T10:00:00.00`,
  levelName: '비지터',
  visitCount: 0,
  articleCount: 0,
  commentCount: 0,
  activityStopped: false,
  answers,
})
const bot = ['남 / 56세', '네, 확인했습니다', '네, 확인했습니다']
const person = ['남/40', '네', '네']

function transport(answer: (message: AppMessage) => ExtensionMessage, connected = true): ExtensionTransport {
  return { isConnected: () => connected, request: async (message: AppMessage) => answer(message) } as unknown as ExtensionTransport
}

const search = (bridge: ExtensionTransport) =>
  createJoinPatternSearch({ transport: bridge, newId: () => 'r', now: () => Date.UTC(2026, 10, 1, 7), sleep: async () => undefined })

const identity = (verified: boolean): ExtensionMessage => ({ type: 'STUDIO_IDENTITY', requestId: 'r', verified })
const page = (members: readonly StudioJoinMember[], totalCount: number, capped = false): ExtensionMessage => ({
  type: 'STUDIO_JOIN_PAGE_COLLECTED',
  requestId: 'r',
  page: 1,
  result: { members, totalCount, capped },
})

describe('join pattern search', () => {
  it('asks about the identity check before reading any member', async () => {
    const seen: string[] = []
    const result = await search(
      transport((message) => {
        seen.push(message.type)
        return identity(false)
      }),
    ).search()
    expect(result).toEqual({ kind: 'IDENTITY_REQUIRED' })
    expect(seen).toEqual(['CHECK_STUDIO_IDENTITY'])
  })

  it('reads every window to its count and keeps only the matches', async () => {
    const wanted = createJoinPatternSearch({
      transport: transport((message) => {
        if (message.type === 'CHECK_STUDIO_IDENTITY') return identity(true)
        if (message.type !== 'COLLECT_STUDIO_JOIN_PAGE') throw new Error(message.type)
        if (message.joinedTo === '2026-11-01') return page(message.page === 1 ? [member('01', person)] : [member('02', bot)], 2)
        return page([], 0)
      }),
      newId: () => 'r',
      now: () => Date.UTC(2026, 10, 1, 7),
      sleep: async () => undefined,
    })
    const result = await wanted.search()
    expect(result).toMatchObject({ kind: 'DONE', scannedCount: 2, from: '2026-10-03', to: '2026-11-01' })
    expect(wanted.latestCandidates().map((candidate) => candidate.memberKey)).toEqual(['02'])
  })

  it('gives no partial list when a window comes up short', async () => {
    const result = await search(
      transport((message) => (message.type === 'CHECK_STUDIO_IDENTITY' ? identity(true) : page([], 5))),
    ).search()
    expect(result).toEqual({ kind: 'FAILED', code: 'STUDIO_WINDOW_SHORT' })
  })

  it('refuses a window the list capped', async () => {
    const result = await search(
      transport((message) => (message.type === 'CHECK_STUDIO_IDENTITY' ? identity(true) : page([], 5000, true))),
    ).search()
    expect(result).toEqual({ kind: 'FAILED', code: 'STUDIO_WINDOW_CAPPED' })
  })

  it('goes back to the check when it lapses mid-search', async () => {
    const result = await search(
      transport((message) =>
        message.type === 'CHECK_STUDIO_IDENTITY'
          ? identity(true)
          : { type: 'ERROR', requestId: 'r', code: 'STUDIO_IDENTITY_REQUIRED', message: '' },
      ),
    ).search()
    expect(result).toEqual({ kind: 'IDENTITY_REQUIRED' })
  })

  it('says so when no extension is connected', async () => {
    expect(await search(transport(() => identity(true), false)).search()).toEqual({ kind: 'EXTENSION_OFFLINE' })
  })
})
