import { describe, expect, it } from 'vitest'
import { previewToday } from '../../src/desktop/preview.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { kstDayStartMs } from '../../src/shared/kst.js'

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
    existingCommentAuthors: [],
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

const deps = (over: Partial<Parameters<typeof previewToday>[0]>) => ({
  cafeId: CAFE,
  boardId: '5',
  automationId: 'auto-1',
  nowMs: NOW,
  newRequestId: () => 'r',
  transport: transportReturning([]),
  operatorAccounts: [],
  ...over,
})

describe('previewToday', () => {
  it('counts posts from different authors', async () => {
    const candidates = [
      raw({ postId: '1001', authorNickname: '가입자하나', authorId: 'member-1' }),
      raw({ postId: '1002', authorNickname: '가입자둘', authorId: 'member-2' }),
      raw({ postId: '1003', authorNickname: '가입자셋', authorId: 'member-3' }),
    ]
    const result = await previewToday(deps({ transport: transportReturning(candidates) }))
    expect(result).toEqual({ kind: 'READY', count: 3, checkedAt: NOW })
  })

  it('counts only the first post when same author posts multiple times', async () => {
    const candidates = [
      raw({ postId: '1001', authorNickname: '가입자하나', authorId: 'member-1', postedAt: NOW - 120_000 }),
      raw({ postId: '1002', authorNickname: '가입자하나', authorId: 'member-1', postedAt: NOW - 60_000 }),
      raw({ postId: '1003', authorNickname: '가입자둘', authorId: 'member-2' }),
    ]
    const result = await previewToday(deps({ transport: transportReturning(candidates) }))
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
        return Promise.reject(new Error('unexpected'))
      },
    }
    const result = await previewToday(deps({ transport }))
    expect(result).toEqual({ kind: 'UNAVAILABLE', reason: 'READ_FAILED' })
  })

  it('never sends EXECUTE messages', async () => {
    const candidates = [
      raw({ postId: '1001', authorNickname: '가입자하나', authorId: 'member-1' }),
      raw({ postId: '1002', authorNickname: '가입자둘', authorId: 'member-2' }),
    ]
    const transport = transportReturning(candidates)
    await previewToday(deps({ transport }))
    const executeMessages = transport.asked.filter((msg) => msg.type === 'EXECUTE')
    expect(executeMessages).toHaveLength(0)
  })

  it('only collects from the start of today', async () => {
    const candidates = [raw({ postId: '1001', authorId: 'member-1' })]
    const transport = transportReturning(candidates)
    await previewToday(deps({ transport }))
    const collectMessage = transport.asked.find((msg) => msg.type === 'COLLECT')
    expect(collectMessage).toBeDefined()
    if (collectMessage && collectMessage.type === 'COLLECT') {
      expect(collectMessage.sincePostedAt).toEqual(kstDayStartMs(NOW))
    }
  })
})
