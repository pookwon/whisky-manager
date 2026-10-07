import { describe, expect, it } from 'vitest'
import { isPastListEnd } from '../../src/desktop/collectionListEnd.js'
import type { CollectedArticlePage, CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

function post(id: string): CollectedPostMetadata {
  return { cafeId: '14538121', postId: id, boardId: '1', boardName: null, title: null, prefix: null, authorId: null, authorNickname: null, postedAt: 1, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false }
}

function page(items: CollectedPostMetadata[], lastNavigationPageNumber: number): CollectedArticlePage {
  return { items, pageInfo: { lastNavigationPageNumber, visibleNextButton: false, totalArticleCount: null }, pageIdentity: 'p' }
}

describe('isPastListEnd', () => {
  it('reads the newest page answered for a page beyond the navigation as past the end', () => {
    expect(isPastListEnd(page([post('1')], 10), 11)).toBe(true)
  })

  it('reads an empty page as past the end whatever its page info says', () => {
    expect(isPastListEnd(page([], 30), 25)).toBe(true)
    expect(isPastListEnd(page([], 0), 11)).toBe(true)
  })

  it('reads a page with posts inside the navigation as the page asked for', () => {
    expect(isPastListEnd(page([post('1')], 10), 10)).toBe(false)
  })
})
