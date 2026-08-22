import { describe, expect, it } from 'vitest'
import type { Guard, GuardContext } from '../../src/shared/guards.js'
import { evaluateGuards, operatorAlreadyCommentedGuard } from '../../src/shared/guards.js'
import type { Candidate } from '../../src/shared/types.js'

const candidate: Candidate = {
  automationId: 'welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  postId: '1001',
  title: '가입인사 드립니다',
  bodyText: '안녕하세요, 위스키 좋아합니다.',
  authorNickname: '신입회원',
  authorId: 'member-1',
  postedAt: 1_700_000_000_000,
}

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    nowMs: 1_700_000_100_000,
    operatorAccounts: ['cafe-ops'],
    existingCommentAuthors: [],
    ...overrides,
  }
}

describe('operatorAlreadyCommentedGuard', () => {
  it('passes when no operator has commented', () => {
    expect(operatorAlreadyCommentedGuard(candidate, ctx())).toBeNull()
  })

  it('skips when an operator account already commented', () => {
    expect(operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: ['cafe-ops'] }))).toEqual({
      kind: 'SKIP',
      reason: 'ALREADY_COMMENTED',
    })
  })

  it('skips when any listed staff account commented, not just the executing one', () => {
    const outcome = operatorAlreadyCommentedGuard(
      candidate,
      ctx({ operatorAccounts: ['cafe-ops', 'staff-personal'], existingCommentAuthors: ['staff-personal'] }),
    )
    expect(outcome).toEqual({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })
  })

  it('ignores comments from ordinary members', () => {
    expect(operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: ['random-member'] }))).toBeNull()
  })

  it('raises a risk flag when the comment check could not be performed', () => {
    expect(operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: null }))).toEqual({
      kind: 'RISK',
      flag: 'COMMENT_CHECK_FAILED',
    })
  })
})

describe('evaluateGuards', () => {
  const risky: Guard = () => ({ kind: 'RISK', flag: 'STRUCTURE_CHANGED' })
  const clean: Guard = () => null
  const skipping: Guard = () => ({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })

  it('collects no flags when every guard passes', () => {
    expect(evaluateGuards([clean, clean], candidate, ctx())).toEqual({ skip: null, flags: [] })
  })

  it('collects risk flags from every guard that raises one', () => {
    expect(evaluateGuards([risky, clean, risky], candidate, ctx())).toEqual({
      skip: null,
      flags: ['STRUCTURE_CHANGED', 'STRUCTURE_CHANGED'],
    })
  })

  it('short-circuits on skip and stops evaluating', () => {
    expect(evaluateGuards([skipping, risky], candidate, ctx())).toEqual({
      skip: 'ALREADY_COMMENTED',
      flags: [],
    })
  })
})
