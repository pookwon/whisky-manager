import { describe, expect, it } from 'vitest'
import { judgeArticleRead } from '../../src/desktop/articleProbeVerdict.js'
import { CollectionPageError } from '../../src/desktop/collectionPageError.js'
import type { CollectedPostMetadata } from '../../src/shared/cafeArticleList.js'

const COLLECTED = new Set(['137', '36'])
const post = (boardId: string): CollectedPostMetadata => ({
  cafeId: '14538121', postId: '728686', boardId, boardName: '게시판', title: '월드컵 홈플러스', prefix: null, authorId: 'key-writer', authorNickname: '글쓴이',
  postedAt: 1749029333663, viewCount: 890, commentCount: 1, replyCount: null, isNotice: false,
})

describe('judgeArticleRead', () => {
  it('stores a live post of a collected board', () => {
    expect(judgeArticleRead('728686', { kind: 'article', post: post('137'), isNotice: false }, COLLECTED)).toEqual({ outcome: 'stored', boardId: '137', post: post('137') })
  })

  it('records the board of a live post it does not collect, and stores nothing', () => {
    expect(judgeArticleRead('728686', { kind: 'article', post: post('188'), isNotice: false }, COLLECTED)).toEqual({ outcome: 'other_board', boardId: '188' })
  })

  it('records a live notice with its board and stores nothing, on any board', () => {
    expect(judgeArticleRead('728686', { kind: 'article', post: post('137'), isNotice: true }, COLLECTED)).toEqual({ outcome: 'notice', boardId: '137' })
    expect(judgeArticleRead('728686', { kind: 'article', post: post('188'), isNotice: true }, COLLECTED)).toEqual({ outcome: 'notice', boardId: '188' })
  })

  it('reads the cafe\'s two known refusals', () => {
    expect(judgeArticleRead('728686', { kind: 'absent', status: 404, code: '4003' }, COLLECTED)).toEqual({ outcome: 'deleted' })
    expect(judgeArticleRead('728686', { kind: 'absent', status: 401, code: '0004' }, COLLECTED)).toEqual({ outcome: 'unreadable', errorCode: '0004' })
  })

  it.each([
    ['an unknown code', 403, '0005'],
    ['a known code with another status', 200, '4003'],
    ['the deleted code at the login status', 401, '4003'],
  ])('does not guess at %s', (_label, status, code) => {
    expect(() => judgeArticleRead('728686', { kind: 'absent', status, code }, COLLECTED)).toThrow(
      new CollectionPageError('ARTICLE_PROBE_UNKNOWN_ANSWER', `id 728686 ${status} ${code}`),
    )
  })
})
