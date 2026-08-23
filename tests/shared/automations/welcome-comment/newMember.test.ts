import { describe, expect, it } from 'vitest'
import { newMemberGuard } from '../../../../src/shared/automations/welcome-comment/newMember.js'
import type { GuardContext } from '../../../../src/shared/guards.js'
import type { AuthorMembership, Candidate } from '../../../../src/shared/types.js'

/** 2026-08-23 12:00 KST. */
const POSTED_AT = Date.UTC(2026, 7, 23, 3, 0)
/** 2026-08-27 12:00 KST. */
const NOW_MS = Date.UTC(2026, 7, 27, 3, 0)

const autoGreeting = (nickname: string): string =>
  `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.`

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    postId: '1001',
    title: null,
    bodyText: '안녕하세요 잘부탁드립니다',
    authorNickname: '가입자하나',
    authorId: 'member-1',
    postedAt: POSTED_AT,
    ...overrides,
  }
}

function ctx(membership: AuthorMembership, windowDays = 3): GuardContext {
  return {
    nowMs: NOW_MS,
    operatorAccounts: [],
    existingCommentAuthors: [],
    authorMembership: membership,
    newMemberWindowDays: windowDays,
  }
}

describe('newMemberGuard', () => {
  it('passes an auto-generated post from someone who joined inside the window', () => {
    const post = candidate({ bodyText: autoGreeting('가입자하나') })
    expect(newMemberGuard(post, ctx({ kind: 'JOINED', joinDate: '2026.08.27.' }))).toBeNull()
  })

  it('skips an auto-generated post from someone who joined outside the window', () => {
    const post = candidate({ bodyText: autoGreeting('가입자하나') })
    expect(newMemberGuard(post, ctx({ kind: 'JOINED', joinDate: '2026.08.23.' }))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_NEW_MEMBER',
    })
  })

  it('passes a member who joined inside the window', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: '2026.08.27.' }))).toBeNull()
  })

  it('passes a member who joined exactly N days ago (3 days)', () => {
    // NOW_MS = 2026-08-27; 3 days before = 2026-08-24
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: '2026.08.24.' }))).toBeNull()
  })

  it('skips a member who joined one day beyond the window', () => {
    // NOW_MS = 2026-08-27; 4 days before = 2026-08-23
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: '2026.08.23.' }))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_NEW_MEMBER',
    })
  })

  it('judges new members as of the day the session runs, not the day the post was written', () => {
    // Post was written 2026-08-23 (POSTED_AT), which is 4 days before NOW_MS (2026-08-27)
    // Member joined 2026-08-25 (2 days before NOW_MS, within 3-day window from today)
    // Old anchor (post date): 2026-08-23 - 2026-08-25 would be negative (makes no sense)
    // But if we measure from post date: post(2026-08-23) - join(2026-08-25) = -2 days ✗
    // We should instead use: now(2026-08-27) - join(2026-08-25) = 2 days ✓ within 3-day window
    const postOn25th = candidate({ postedAt: Date.UTC(2026, 7, 25, 3, 0) })
    expect(newMemberGuard(postOn25th, ctx({ kind: 'JOINED', joinDate: '2026.08.25.' }))).toBeNull()
  })

  it('skips a self-written greeting from someone the table never saw', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'NOT_TRACKED' }))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_NEW_MEMBER',
    })
  })

  it('raises a risk flag when a stored join date is not the shape we store', () => {
    expect(newMemberGuard(candidate(), ctx({ kind: 'JOINED', joinDate: 'garbage' }))).toEqual({
      kind: 'RISK',
      flag: 'STRUCTURE_CHANGED',
    })
  })
})
