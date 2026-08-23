import { describe, expect, it } from 'vitest'
import { firstPostOnlyGuard } from '../../../../src/shared/automations/welcome-comment/firstPost.js'
import type { Candidate } from '../../../../src/shared/types.js'

const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)

function candidate(authorId: string | null): Candidate {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    postId: '1001',
    title: '가입인사',
    bodyText: '반갑습니다',
    authorNickname: '왕밤이',
    authorId,
    postedAt: NOW - 60_000,
  }
}

function context(isFirstPostByAuthor: boolean) {
  return {
    nowMs: NOW,
    operatorAccounts: ['cafe-ops'],
    existingCommentAuthors: [],
    isFirstPostByAuthor,
  }
}

describe('firstPostOnlyGuard', () => {
  it('passes the author\'s earliest greeting', () => {
    expect(firstPostOnlyGuard(candidate('m1'), context(true))).toBeNull()
  })

  it('skips a later greeting by someone already covered', () => {
    expect(firstPostOnlyGuard(candidate('m1'), context(false))).toEqual({
      kind: 'SKIP',
      reason: 'NOT_FIRST_POST',
    })
  })

  it('hands a post with no readable author to the policy', () => {
    // Without an author the one-greeting-per-person promise cannot be kept,
    // and that is a judgement for the operator's policy, not for the guard.
    expect(firstPostOnlyGuard(candidate(null), context(true))).toEqual({
      kind: 'RISK',
      flag: 'AUTHOR_UNKNOWN',
    })
  })
})
