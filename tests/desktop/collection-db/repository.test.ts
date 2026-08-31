import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCafeArticleListText } from '../../../src/shared/cafeArticleList.js'

const PAGE_1 = readFileSync(
  fileURLToPath(new URL('../../fixtures/cafe-article-list-page-1.json', import.meta.url)),
  'utf8',
)

describe('collection page persistence inputs', () => {
  it('keeps the page parser result suitable for a single collection transaction', () => {
    const page = parseCafeArticleListText(PAGE_1)
    expect(page.items).toHaveLength(50)
    expect(new Set(page.items.map((item) => item.postId))).toHaveLength(50)
    expect(page.items.every((item) => item.isNotice === false && item.viewCount >= 0 && item.commentCount >= 0)).toBe(true)
  })

  it('carries a posted time for every row, which the post row stores as an instant', () => {
    // The stored schema has no separate KST date column: the instant is the
    // record, and any day boundary is worked out from it at read time.
    const page = parseCafeArticleListText(PAGE_1)
    expect(page.items.every((item) => Number.isSafeInteger(item.postedAt) && item.postedAt > 0)).toBe(true)
  })
})
