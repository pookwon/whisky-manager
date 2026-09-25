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
})
