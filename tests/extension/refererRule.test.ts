import { describe, expect, it } from 'vitest'
import {
  articleCommentListUrl,
  articleCommentPostUrl,
} from '../../src/shared/automations/prefix-reminder/articleCafe.js'
import { commentPostUrl } from '../../src/shared/automations/welcome-comment/cafe.js'
import { cafeArticleListUrl } from '../../src/shared/cafeArticleFixture.js'
import { cafeBoardSearchReferer, cafeBoardSearchUrl } from '../../src/shared/cafeBoardSearchEndpoint.js'
import { cafeArticleReadReferer, cafeArticleReadUrl } from '../../src/shared/cafeArticleEndpoint.js'
import { REFERER_RULE_IDS, refererRuleFor } from '../../src/extension/refererRule.js'

const REFERER = 'https://cafe.naver.com/ca-fe/cafes/1/articles/2'

const memoWrite = commentPostUrl
const articleWrite = articleCommentPostUrl
const articleRead = articleCommentListUrl({ cafeId: '1', boardId: '2' }, '3', 1)
const boardSearch = cafeBoardSearchUrl({ menuId: '137', query: '글렌', fromDay: '20250101', toDay: '20250131', page: 1 })
const articleById = cafeArticleReadUrl('728686')
/** A collection walk: the same host as the article write, and no referer of its own. */
const collection = cafeArticleListUrl(1, '0')

/**
 * How Chrome reads the condition: `requestDomains` is the host or any
 * sub-domain of it, and `urlFilter` spelled `||host/path` is an anchored
 * host-plus-path prefix.
 */
function matches(rule: chrome.declarativeNetRequest.Rule, url: string): boolean {
  const parsed = new URL(url)
  const domains = rule.condition.requestDomains ?? []
  const onDomain = domains.some(
    (domain) => parsed.host === domain || parsed.host.endsWith(`.${domain}`),
  )
  if (rule.condition.regexFilter !== undefined) {
    if (rule.condition.urlFilter !== undefined) throw new Error('a rule takes one of urlFilter and regexFilter')
    return onDomain && new RegExp(rule.condition.regexFilter).test(url)
  }
  const filter = rule.condition.urlFilter ?? ''
  if (!filter.startsWith('||')) throw new Error(`urlFilter must be host-anchored: ${filter}`)
  return onDomain && `${parsed.host}${parsed.pathname}`.startsWith(filter.slice(2))
}

describe('refererRuleFor', () => {
  it('sets the referer and the origin that goes with it', () => {
    const rule = refererRuleFor(memoWrite, REFERER)
    expect(rule?.action.requestHeaders).toEqual([
      { header: 'referer', operation: 'set', value: REFERER },
      { header: 'origin', operation: 'set', value: 'https://cafe.naver.com' },
    ])
  })

  it('covers every endpoint that needs a referer', () => {
    // A write that slips past this rule is answered with 200 and quietly does
    // nothing, so an uncovered endpoint is a silently lost comment.
    for (const url of [memoWrite, articleWrite, articleRead, boardSearch, articleById]) {
      expect(refererRuleFor(url, REFERER)).not.toBeNull()
    }
  })

  it('gives each endpoint a rule id of its own', () => {
    const ids = [memoWrite, articleWrite, articleRead, boardSearch, articleById].map((url) => refererRuleFor(url, REFERER)?.id)
    // One shared id let a second request's teardown strip the first's rule, and
    // that write then went out with no referer at all.
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) expect(REFERER_RULE_IDS).toContain(id)
  })

  it('routes the board search to rule 4 and sets origin https://cafe.naver.com', () => {
    const rule = refererRuleFor(boardSearch, cafeBoardSearchReferer('137'))
    expect(rule?.id).toBe(4)
    expect(rule?.action.requestHeaders).toContainEqual({
      header: 'origin',
      operation: 'set',
      value: 'https://cafe.naver.com',
    })
    // A collection walk on the main host is not affected by the search rule.
    expect(refererRuleFor(cafeArticleListUrl(1, '137'), 'https://cafe.naver.com/')).toBeNull()
  })

  it('gives the article read by id a rule of its own, which the comment read does not match', () => {
    const rule = refererRuleFor(articleById, cafeArticleReadReferer('728686'))
    expect(rule?.id).toBe(5)
    expect(rule?.priority).toBe(2)
    expect(rule?.condition.urlFilter).toBeUndefined()
    expect(rule !== null && matches(rule, articleById)).toBe(true)
    // The comment read's path starts with the article's: only the query right after the id tells them apart.
    expect(rule !== null && matches(rule, articleRead)).toBe(false)
    expect(rule?.action.requestHeaders).toEqual([
      { header: 'referer', operation: 'set', value: 'https://cafe.naver.com/ca-fe/cafes/14538121/articles/728686' },
      { header: 'origin', operation: 'set', value: 'https://cafe.naver.com' },
    ])
  })

  it('leaves the comment read on rule 3, as it was', () => {
    const rule = refererRuleFor(articleRead, REFERER)
    expect(rule?.id).toBe(3)
    expect(rule?.priority).toBe(1)
    expect(rule?.condition.urlFilter).toBe('||article.cafe.naver.com/gw/v4/')
    expect(rule?.condition.regexFilter).toBeUndefined()
  })

  it('matches only the endpoint it was installed for', () => {
    for (const installedFor of [memoWrite, articleWrite, articleRead, boardSearch]) {
      const rule = refererRuleFor(installedFor, REFERER)
      if (rule === null) throw new Error(`no rule for ${installedFor}`)
      for (const url of [memoWrite, articleWrite, articleRead, boardSearch]) {
        expect(matches(rule, url)).toBe(url === installedFor)
      }
    }
  })

  it('leaves a collection read alone while any write rule is installed', () => {
    // The board list is on the same host as the article write and legitimately
    // carries neither referer nor origin. A rule scoped to the whole host would
    // rewrite both on it, in the middle of someone else's write.
    for (const url of [memoWrite, articleWrite, articleRead, boardSearch]) {
      const rule = refererRuleFor(url, REFERER)
      if (rule === null) throw new Error(`no rule for ${url}`)
      expect(matches(rule, collection)).toBe(false)
    }
    expect(refererRuleFor(collection, REFERER)).toBeNull()
  })

  it('reaches no host outside the cafe', () => {
    expect(refererRuleFor('https://naver.com/', REFERER)).toBeNull()
    expect(refererRuleFor('https://example.com/', REFERER)).toBeNull()
  })
})
