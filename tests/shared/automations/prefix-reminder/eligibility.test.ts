import { describe, expect, it } from 'vitest'
import type { CollectedPostMetadata } from '../../../../src/shared/cafeArticleList.js'
import {
  classifyPost,
  emptyTally,
  tallyOne,
} from '../../../../src/shared/automations/prefix-reminder/eligibility.js'

const post = (over: Partial<CollectedPostMetadata>): CollectedPostMetadata => ({
  cafeId: '14538121', postId: '1', boardId: '137', boardName: '국내구입기', title: 't', prefix: null,
  authorId: 'key-x', authorNickname: 'x', postedAt: 1_800_000_000_000, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false, ...over,
})
const rules = { excludedBoardIds: new Set(['147', '1']), operatorAccounts: ['cafe-ops', 'key-ops'] }

describe('classifyPost', () => {
  it('passes a post with no prefix on an ordinary board by an ordinary member', () => expect(classifyPost(post({}), rules)).toBe('ELIGIBLE'))
  it('drops a post that carries a prefix', () => expect(classifyPost(post({ prefix: '질문' }), rules)).toBe('HAS_PREFIX'))
  it('drops a post on an excluded board', () => expect(classifyPost(post({ boardId: '147' }), rules)).toBe('EXCLUDED_BOARD'))
  it('drops an operator post, by member key or by nickname', () => {
    expect(classifyPost(post({ authorId: 'key-ops' }), rules)).toBe('AUTHOR_IS_OPERATOR')
    expect(classifyPost(post({ authorNickname: 'cafe-ops' }), rules)).toBe('AUTHOR_IS_OPERATOR')
  })
  it('names the first reason when several apply: board, then operator, then prefix', () => {
    expect(classifyPost(post({ boardId: '147', prefix: '질문', authorId: 'key-ops' }), rules)).toBe('EXCLUDED_BOARD')
  })
})

describe('tally', () => {
  it('counts without mutating', () => {
    const a = emptyTally()
    const b = tallyOne(tallyOne(a, 'ELIGIBLE'), 'HAS_PREFIX')
    expect(a.read).toBe(0)
    expect(b).toEqual({ read: 2, eligible: 1, droppedBy: { HAS_PREFIX: 1, EXCLUDED_BOARD: 0, AUTHOR_IS_OPERATOR: 0 } })
  })
})
