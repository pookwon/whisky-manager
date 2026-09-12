import { describe, expect, it } from 'vitest'
import { articleCommentListUrl, articleCommentPostUrl } from '../../src/shared/automations/prefix-reminder/articleCafe.js'
import { commentPostUrl } from '../../src/shared/automations/welcome-comment/cafe.js'
import { REFERER_RULE_ID, refererRule } from '../../src/extension/refererRule.js'

const rule = refererRule('https://cafe.naver.com/ca-fe/cafes/1/articles/2')

/** How Chrome reads `requestDomains`: the domain itself or any sub-domain. */
function covered(url: string): boolean {
  const host = new URL(url).host
  return (rule.condition.requestDomains ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`))
}

describe('refererRule', () => {
  it('sets the referer and the origin that goes with it', () => {
    expect(rule.id).toBe(REFERER_RULE_ID)
    expect(rule.action.requestHeaders).toEqual([
      { header: 'referer', operation: 'set', value: 'https://cafe.naver.com/ca-fe/cafes/1/articles/2' },
      { header: 'origin', operation: 'set', value: 'https://cafe.naver.com' },
    ])
  })

  it('covers every endpoint that needs a referer', () => {
    // A write that slips past this rule is answered with 200 and quietly does
    // nothing, so an uncovered host is a silently lost comment.
    expect(covered(commentPostUrl)).toBe(true)
    expect(covered(articleCommentPostUrl)).toBe(true)
    expect(covered(articleCommentListUrl({ cafeId: '1', boardId: '2' }, '3', 1))).toBe(true)
  })

  it('reaches no host outside the cafe', () => {
    expect(covered('https://naver.com/')).toBe(false)
    expect(covered('https://example.com/')).toBe(false)
  })
})
