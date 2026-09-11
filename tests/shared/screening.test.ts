import { describe, expect, it } from 'vitest'
import { firstPostIdByAuthor, screenCandidate, type ScreeningContext, type PostFacts } from '../../src/shared/screening.js'
import type { RawCandidate } from '../../src/shared/protocol.js'

const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)

function makeRaw(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    boardId: '42',
    postId: '1001',
    title: '가입인사',
    bodyText: '반갑습니다',
    authorNickname: '신입회원',
    authorId: 'member-1',
    postedAt: NOW - 60_000,
    commentCount: 0,
    prefix: null,
    ...overrides,
  }
}

const ctx: ScreeningContext = {
  automationId: 'welcome-comment',
  source: { cafeId: '10000000', boardId: '42' },
  policy: 'AUTO',
  guards: [],
  operatorAccounts: [],
  firstPosts: new Map(),
  renderBody: () => ({ ok: true, templateId: 'tpl', body: 'x' }),
}

const facts: PostFacts = {
  nowMs: NOW,
  existingCommentAuthors: [],
}

describe('screenCandidate — boardId and prefix forwarding', () => {
  it('forwards boardId from RawCandidate into the produced Candidate', () => {
    const raw = makeRaw({ boardId: '99' })
    const { candidate } = screenCandidate(raw, ctx, facts)
    expect(candidate.boardId).toBe('99')
  })

  it('forwards null prefix from RawCandidate into the produced Candidate', () => {
    const raw = makeRaw({ prefix: null })
    const { candidate } = screenCandidate(raw, ctx, facts)
    expect(candidate.prefix).toBeNull()
  })

  it('forwards a non-null prefix from RawCandidate into the produced Candidate', () => {
    const raw = makeRaw({ prefix: '판매' })
    const { candidate } = screenCandidate(raw, ctx, facts)
    expect(candidate.prefix).toBe('판매')
  })
})

describe('firstPostIdByAuthor — unaffected by new fields', () => {
  it('still returns the earliest post by author when boardId and prefix are present', () => {
    const authorId = 'author-1'
    const earlier = makeRaw({ postId: '1001', authorId, postedAt: NOW - 60_000, boardId: '5', prefix: null })
    const later = makeRaw({ postId: '1002', authorId, postedAt: NOW - 30_000, boardId: '5', prefix: '판매' })
    expect(firstPostIdByAuthor([earlier, later]).get(authorId)).toBe('1001')
  })
})
