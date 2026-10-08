import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CafeArticleListParseError } from '../../src/shared/cafeArticleList.js'
import { parseCafeBoardSearchList, parseCafeBoardSearchListText } from '../../src/shared/cafeBoardSearchList.js'

const sample = readFileSync(fileURLToPath(new URL('../fixtures/cafe-board-search-sample.json', import.meta.url)), 'utf8')
const parsed = (): { result: { articleList: { item: Record<string, unknown> }[]; pageInfo: Record<string, unknown> } } =>
  JSON.parse(sample) as never

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof CafeArticleListParseError ? error.code : 'NOT_A_PARSE_ERROR'
  }
}

describe('parseCafeBoardSearchList', () => {
  it('maps a search item onto the same metadata the list walk stores', () => {
    const page = parseCafeBoardSearchListText(sample)
    expect(page.items[0]).toEqual({
      cafeId: '14538121',
      postId: '667901',
      boardId: '137',
      boardName: null,
      title: '글렌알라키 12 이마트 구매',
      prefix: '정보',
      authorId: 'member-key-a',
      authorNickname: '테스트회원가',
      postedAt: Date.UTC(2025, 0, 31, 14, 59, 26, 667),
      viewCount: 120,
      commentCount: 4,
      replyCount: 0,
      isNotice: false,
    })
    expect(page.items[1]).toMatchObject({ postId: '667850', prefix: null, replyCount: 2 })
  })

  it('stores the title as the cafe shows it, without the search highlight or HTML escaping', () => {
    // The search answers `subject` as HTML: the matched word in <b>, and `&`,
    // `<`, `>` escaped (seen 2026-09-25: `글렌터렛 12년 &amp; 아벨라워12년 <b>구매</b>`).
    const value = parsed()
    value.result.articleList[0]!.item.subject = '&lt;트레이더스&gt; <b>글렌</b>터렛 12년 &amp; 아벨라워 <b>구매</b>'
    expect(parseCafeBoardSearchList(value).items[0]!.title).toBe('<트레이더스> 글렌터렛 12년 & 아벨라워 구매')
    expect(parseCafeBoardSearchListText(sample).items.map((item) => item.title)).toEqual(['글렌알라키 12 이마트 구매', '글렌 두 병'])
  })

  it('reads the total the search reports', () => {
    expect(parseCafeBoardSearchListText(sample).pageInfo).toEqual({
      totalArticleCount: 578,
      lastNavigationPageNumber: 10,
      visibleNextButton: true,
    })
  })

  it('gives an empty past-the-end page a valid identity', () => {
    const value = parsed()
    value.result.articleList = []
    const page = parseCafeBoardSearchList(value)
    expect(page.items).toEqual([])
    expect(page.pageIdentity).toMatch(/^fnv1a64:/)
  })

  it('reads the empty page past a capped search, whose page info is all zero, as an empty page', () => {
    // Captured 2026-09-25: page 81 of board 137 "구매", after 80 full pages.
    const value = parsed()
    value.result.articleList = []
    value.result.pageInfo = { totalArticleCount: 0, lastNavigationPageNumber: 0, visibleNextButton: false }
    const page = parseCafeBoardSearchList(value)
    expect(page.items).toEqual([])
    expect(page.pageInfo).toEqual({ totalArticleCount: 0, lastNavigationPageNumber: 0, visibleNextButton: false })
  })

  it('refuses a page with posts whose page info is all zero', () => {
    const value = parsed()
    value.result.pageInfo = { totalArticleCount: 0, lastNavigationPageNumber: 0, visibleNextButton: false }
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_PAGE_INFO')
  })

  it('parses a post time written on the minute with no seconds', () => {
    // Post 672653 on board 137, captured 2026-09-26: addDate "2025-02-06T16:00"
    // (Java LocalDateTime.toString omits ":ss" when seconds are zero).
    const value = parsed()
    value.result.articleList[0]!.item.addDate = '2025-02-06T16:00'
    expect(parseCafeBoardSearchList(value).items[0]!.postedAt).toBe(Date.UTC(2025, 1, 6, 7, 0))
  })

  it('refuses a post time it cannot read as KST', () => {
    const value = parsed()
    value.result.articleList[0]!.item.addDate = '2025-01-31T23:59:26+09:00'
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('refuses an item missing a field the post row needs', () => {
    const value = parsed()
    delete value.result.articleList[0]!.item.refArticleCount
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('refuses a missing page info and a non-JSON body', () => {
    const value = parsed()
    delete (value.result as Record<string, unknown>).pageInfo
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_PAGE_INFO')
    expect(codeOf(() => parseCafeBoardSearchListText('<html>login</html>'))).toBe('INVALID_JSON')
  })

  it('refuses the same post twice on one page', () => {
    const value = parsed()
    value.result.articleList[1]!.item.articleId = 667901
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('DUPLICATE_POST_ID')
  })

  it('reads commentCount -1 as null (search does not know the count)', () => {
    // Captured 2026-09-26: board 137 "홈플" page 2, articleId 753801 — the
    // search index reported commentCount: -1 for a post missing from our DB.
    const value = parsed()
    value.result.articleList[0]!.item.commentCount = -1
    expect(parseCafeBoardSearchList(value).items[0]!.commentCount).toBeNull()
  })

  it('reads refArticleCount -1 as an unknown reply count', () => {
    const value = parsed()
    value.result.articleList[0]!.item.refArticleCount = -1
    expect(parseCafeBoardSearchList(value).items[0]!.replyCount).toBeNull()
  })

  it('reads readCount -1 as an unknown view count, and refuses -2', () => {
    const value = parsed()
    value.result.articleList[0]!.item.readCount = -1
    expect(parseCafeBoardSearchList(value).items[0]!.viewCount).toBeNull()
    value.result.articleList[0]!.item.readCount = -2
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('refuses commentCount -2 (only -1 is a known unknown sentinel)', () => {
    const value = parsed()
    value.result.articleList[0]!.item.commentCount = -2
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('reads a headed item the search cannot name as a prefix it does not know', () => {
    // Captured 2026-10-08: board 137 "면세" answers board-188 posts headed 364
    // '국내공항면세' and 634 '면세퀵턴', prefixes board 137 does not define, and
    // leaves their headName out. The named item beside it shows the field exists.
    const value = parsed()
    value.result.articleList[1]!.item.headId = 634
    const page = parseCafeBoardSearchList(value)
    expect(page.items[0]).toMatchObject({ postId: '667901', prefix: '정보' })
    expect(page.items[0]!.prefixUnnamed).toBeUndefined()
    expect(page.items[1]).toMatchObject({ postId: '667850', prefix: null, prefixUnnamed: true })
  })

  it('still refuses a page whose headed items all lack headName, as a renamed field', () => {
    const value = parsed()
    delete value.result.articleList[0]!.item.headName
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
    value.result.articleList[1]!.item.headId = 634
    expect(codeOf(() => parseCafeBoardSearchList(value))).toBe('INVALID_ARTICLE')
  })

  it('does not mark a post without a prefix as unnamed', () => {
    const page = parseCafeBoardSearchListText(sample)
    expect(page.items[1]!.prefixUnnamed).toBeUndefined()
  })

})
