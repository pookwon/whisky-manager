import { describe, expect, it } from 'vitest'
import {
  cafeArticlePageIdentity,
  type CollectedArticlePage,
  type CollectedPostMetadata,
} from '../../src/shared/cafeArticleList.js'
import { kstDayStartMs } from '../../src/shared/kst.js'
import type { EligibilityTally } from '../../src/shared/automations/prefix-reminder/eligibility.js'
import {
  createTodayArticleCollector,
  toRawCandidate,
} from '../../src/desktop/prefixReminderCollection.js'
import { SequenceRandom } from '../fakes.js'

const DAY = kstDayStartMs(Date.UTC(2026, 8, 11, 3, 0, 0)) // 2026-09-11 KST
const at = (hourKst: number) => DAY + hourKst * 3_600_000

const post = (over: Partial<CollectedPostMetadata>): CollectedPostMetadata => ({
  cafeId: '14538121', postId: '1', boardId: '137', boardName: '국내구입기', title: 't', prefix: null,
  authorId: 'key-x', authorNickname: 'x', postedAt: 1_800_000_000_000, viewCount: 0, commentCount: 0, replyCount: 0, isNotice: false, ...over,
})
const page = (items: CollectedPostMetadata[]): CollectedArticlePage => ({
  items,
  pageInfo: { lastNavigationPageNumber: 10, visibleNextButton: true, totalArticleCount: null },
  pageIdentity: cafeArticlePageIdentity(items.map((i) => i.postId)),
})

function collector(
  pages: Record<number, CollectedArticlePage | Error>,
  rules = { excludedBoardIds: new Set<string>(), operatorAccounts: [] as string[] },
) {
  const tallies: EligibilityTally[] = []
  const read: number[] = []
  const collect = createTodayArticleCollector({
    fetcher: {
      read: (n) => {
        read.push(n)
        const p = pages[n]
        if (p === undefined) return Promise.resolve(page([]))
        return p instanceof Error ? Promise.reject(p) : Promise.resolve(p)
      },
    },
    rules,
    random: new SequenceRandom([0]),
    sleep: () => Promise.resolve(),
    onTally: (_day, t) => tallies.push(t),
  })
  return { collect, tallies, read }
}

describe('createTodayArticleCollector', () => {
  it('walks pages until one reaches into yesterday and keeps only today', async () => {
    const { collect, read } = collector({
      1: page([post({ postId: '3', postedAt: at(14) }), post({ postId: '2', postedAt: at(9) })]),
      2: page([post({ postId: '1', postedAt: at(-1) })]), // yesterday 23:00 KST
    })
    const raws = await collect(DAY)
    expect(raws?.map((r) => r.postId)).toEqual(['2', '3']) // oldest first
    expect(read).toEqual([1, 2])
  })
  it('stops on an empty page and on a page identical to the last', async () => {
    const { collect, read } = collector({
      1: page([post({ postId: '2', postedAt: at(9) })]),
      2: page([post({ postId: '2', postedAt: at(9) })]), // same identity as page 1
    })
    await collect(DAY)
    expect(read).toEqual([1, 2]) // page 3 never requested
  })
  it('returns null when a page cannot be read', async () => {
    const { collect } = collector({ 1: new Error('BOARD_PAGE_HTTP_ERROR') })
    expect(await collect(DAY)).toBeNull()
  })
  it('hands over only eligible posts and reports what it dropped', async () => {
    const { collect, tallies } = collector(
      {
        1: page([
          post({ postId: '4', postedAt: at(12), prefix: '질문' }),
          post({ postId: '3', postedAt: at(11), boardId: '147' }),
          post({ postId: '2', postedAt: at(10), authorId: 'key-ops' }),
          post({ postId: '1', postedAt: at(-2) }),
        ]),
      },
      { excludedBoardIds: new Set(['147']), operatorAccounts: ['key-ops'] },
    )
    const raws = await collect(DAY)
    expect(raws).toEqual([])
    expect(tallies).toEqual([{ read: 3, eligible: 0, droppedBy: { HAS_PREFIX: 1, EXCLUDED_BOARD: 1, AUTHOR_IS_OPERATOR: 1 } }])
  })
  it('maps list metadata onto a candidate', () => {
    expect(toRawCandidate(post({ postId: '9', boardId: '137', prefix: null, commentCount: 2, title: 'T', authorId: 'k', authorNickname: 'n', postedAt: at(1) })))
      .toEqual({ boardId: '137', postId: '9', title: 'T', bodyText: null, authorNickname: 'n', authorId: 'k', postedAt: at(1), commentCount: 2, prefix: null })
  })
})
