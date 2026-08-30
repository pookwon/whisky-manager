import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCafeArticleListText } from '../../../src/shared/cafeArticleList.js'
import { postedDateKstFromEpochMs } from '../../../src/desktop/collection-db/repository.js'

const PAGE_1 = readFileSync(
  fileURLToPath(new URL('../../fixtures/cafe-article-list-page-1.json', import.meta.url)),
  'utf8',
)

describe('collection page persistence inputs', () => {
  it('derives the storage date from KST rather than the machine timezone', () => {
    expect(postedDateKstFromEpochMs(Date.UTC(2026, 6, 27, 15, 0, 0))).toBe('2026-07-28')
    expect(postedDateKstFromEpochMs(Date.UTC(2026, 6, 28, 14, 59, 59))).toBe('2026-07-28')
    expect(postedDateKstFromEpochMs(Date.UTC(2026, 6, 28, 15, 0, 0))).toBe('2026-07-29')
  })

  it('keeps the page parser result suitable for a single collection transaction', () => {
    const page = parseCafeArticleListText(PAGE_1)
    expect(page.items).toHaveLength(50)
    expect(new Set(page.items.map((item) => item.postId))).toHaveLength(50)
    expect(page.items.every((item) => item.isNotice === false && item.viewCount >= 0 && item.commentCount >= 0)).toBe(true)
  })
})
