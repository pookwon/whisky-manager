import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { kstDayRange } from '../../src/shared/kst.js'
import {
  CafeArticleListParseError,
  cafeArticlePageIdentity,
  parseCafeArticleList,
  parseCafeArticleListText,
} from '../../src/shared/cafeArticleList.js'

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')
}

function parsedFixture(name: string) {
  return parseCafeArticleListText(fixture(name))
}

describe('parseCafeArticleList', () => {
  it('maps the confirmed ARTICLE envelope without exposing likeCount', () => {
    const page = parsedFixture('cafe-article-list-page-1.json')

    expect(page.items).toHaveLength(50)
    expect(page.pageInfo).toEqual({ lastNavigationPageNumber: 10, visibleNextButton: true, totalArticleCount: 739737 })
    expect(page.pageIdentity).toBe('fnv1a64:99ee2c43e0e8092d')
    expect(page.items[0]).toMatchObject({
      cafeId: '14538121',
      postId: '925866',
      boardId: '189',
      boardName: '해외구입기 & 정보',
      prefix: '동남아',
      postedAt: 1788071499997,
      viewCount: 17,
      commentCount: 0,
      replyCount: 0,
      isNotice: false,
    })
    expect(page.items[0]).not.toHaveProperty('likeCount')
    expect(page.items.find((item) => item.prefix === null)?.prefix).toBeNull()
  })

  it('keeps page identity independent of response order and defines one for an empty page', () => {
    expect(cafeArticlePageIdentity(['3', '1', '2'])).toBe(cafeArticlePageIdentity(['2', '3', '1']))
    expect(cafeArticlePageIdentity([])).toBe('fnv1a64:d9eeb45d8363e121')
  })

  it('shows page 14795 is a shifted newest-page window, not an exact cross-capture identity match', () => {
    const first = parsedFixture('cafe-article-list-page-1.json')
    const fallback = parsedFixture('cafe-article-list-page-14795.json')
    const firstIds = first.items.map((item) => item.postId)
    const fallbackIds = fallback.items.map((item) => item.postId)
    const sharedIds = fallbackIds.filter((postId) => firstIds.includes(postId))

    // The captures are not simultaneous: two posts arrived between them. A
    // Phase 4 fallback check must therefore compare a same-run page-1 baseline.
    expect(fallback.pageIdentity).not.toBe(first.pageIdentity)
    expect(fallbackIds.slice(2)).toEqual(firstIds.slice(0, -2))
    expect(sharedIds).toHaveLength(48)
    expect(fallback.pageInfo.lastNavigationPageNumber).toBe(10)
  })

  it('keeps the page 300 timestamp at millisecond precision in the 2026-07-28 KST day', () => {
    const page = parsedFixture('cafe-article-list-page-300.json')
    const kstJuly28 = kstDayRange(Date.UTC(2026, 6, 27, 15))

    expect(page.items).toHaveLength(50)
    expect(page.pageIdentity).toBe('fnv1a64:672bd5d7c7ea01c9')
    expect(page.items.every((item) => item.postedAt >= kstJuly28.startMs && item.postedAt < kstJuly28.endMs)).toBe(true)
    expect(page.items.some((item) => item.postedAt % 1000 !== 0)).toBe(true)
  })

  it('rejects invalid envelopes, login HTML, unknown entry types, and unsafe count values', () => {
    expectParseError('<html><form id="login"></form></html>', 'INVALID_JSON')
    expectParseError('{"result":{"articleList":[]}}', 'INVALID_PAGE_INFO')
    expectParseError({ result: { articleList: [{ type: 'NOTICE', item: {} }], pageInfo: validPageInfo() } }, 'UNEXPECTED_LIST_ENTRY_TYPE')

    const badCount = validArticle()
    badCount.readCount = -1
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: badCount }], pageInfo: validPageInfo() } }, 'INVALID_ARTICLE')

    const nullCount = { ...validArticle(), commentCount: null }
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: nullCount }], pageInfo: validPageInfo() } }, 'INVALID_ARTICLE')

    const seconds = validArticle()
    seconds.writeDateTimestamp = 1_788_071_499
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: seconds }], pageInfo: validPageInfo() } }, 'INVALID_ARTICLE')

    const unsafeId = validArticle()
    unsafeId.articleId = Number.MAX_SAFE_INTEGER + 1
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: unsafeId }], pageInfo: validPageInfo() } }, 'INVALID_ARTICLE')
  })

  it('reads both spellings a post without a prefix uses, and still rejects a headed post with no name', () => {
    const omitted: Record<string, unknown> = { ...validArticle() }
    delete omitted.headName
    const omittedPage = parseCafeArticleList({ result: { articleList: [{ type: 'ARTICLE', item: omitted }], pageInfo: validPageInfo() } })
    expect(omittedPage.items[0]?.prefix).toBeNull()

    // Observed live alongside the omitted spelling on one page: headId 0 is how
    // the same "no prefix" state is reported when the field is present.
    const zeroHead = { ...omitted, headId: 0 }
    const zeroPage = parseCafeArticleList({ result: { articleList: [{ type: 'ARTICLE', item: zeroHead }], pageInfo: validPageInfo() } })
    expect(zeroPage.items[0]?.prefix).toBeNull()

    const headedWithoutName = { ...omitted, headId: 368 }
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: headedWithoutName }], pageInfo: validPageInfo() } }, 'INVALID_ARTICLE')
  })

  it('rejects missing required fields and duplicate ordinary post IDs rather than silently shortening a page', () => {
    const missing = { ...validArticle(), writerInfo: { nickName: null } }
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: missing }], pageInfo: validPageInfo() } }, 'INVALID_ARTICLE')

    const first = validArticle()
    const second = validArticle()
    expectParseError({ result: { articleList: [{ type: 'ARTICLE', item: first }, { type: 'ARTICLE', item: second }], pageInfo: validPageInfo() } }, 'DUPLICATE_POST_ID')
  })
})

function validPageInfo() {
  return { lastNavigationPageNumber: 1, visibleNextButton: false, totalArticleCount: 1 }
}

function validArticle() {
  return {
    articleId: 1,
    cafeId: 14538121,
    menuId: 0,
    menuName: '전체글보기',
    subject: '제목',
    headName: null,
    writerInfo: { memberKey: null, nickName: null },
    writeDateTimestamp: 1_788_071_499_997,
    readCount: 0,
    commentCount: 0,
    replyArticleCount: 0,
  }
}

function expectParseError(value: unknown, code: string): void {
  try {
    if (typeof value === 'string') parseCafeArticleListText(value)
    else parseCafeArticleList(value)
    throw new Error('expected parser to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(CafeArticleListParseError)
    expect((error as CafeArticleListParseError).code).toBe(code)
  }
}
