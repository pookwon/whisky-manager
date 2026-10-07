import { describe, expect, it } from 'vitest'
import { collectionPipelineStage } from '../../src/desktop/collectionPipelineStage.js'
import { describeJob } from '../../src/desktop/collectionScope.js'
import type { StoredFeedState } from '../../src/desktop/collection-db/repository.js'

// [2024-01-01, 2025-01-02) KST.
const START = Date.UTC(2023, 11, 31, 15)
const END = Date.UTC(2025, 0, 1, 15)
const PERIOD = { fromDay: '20240101', toDay: '20250102' }

function feed(menuId: string, queueOrder: number, facts: Partial<StoredFeedState> = {}): StoredFeedState {
  return {
    feed: { feedKind: 'board', menuId }, queueOrder, boardName: `게시판${menuId}`,
    stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null, cursorUpdatedAtMs: 0,
    targetStartMs: START, targetEndMs: END, complete: false, forced: false, horizonReached: false,
    searchExtended: false, searchFinished: false, probeFinished: false, ...facts,
  }
}
const stage = (...feeds: StoredFeedState[]) => collectionPipelineStage(describeJob(feeds))

describe('collectionPipelineStage', () => {
  it('is idle without a period', () => {
    expect(collectionPipelineStage(null)).toEqual({ kind: 'idle' })
  })

  it('walks the list while any board is neither finished nor beyond reach', () => {
    expect(stage(feed('188', 1, { horizonReached: true }), feed('137', 2))).toEqual({ kind: 'list', period: PERIOD })
  })

  it('searches the boards the list could not finish, one at a time in queue order, once the list is settled', () => {
    const feeds = [feed('189', 1, { complete: true }), feed('205', 2, { horizonReached: true }), feed('188', 3, { horizonReached: true, searchExtended: true })]
    expect(stage(...feeds)).toEqual({ kind: 'search', period: PERIOD, boardId: '205', boardName: '게시판205', position: 1, count: 2, searchExtended: false })
    expect(stage(feeds[0]!, { ...feeds[1]!, searchFinished: true }, feeds[2]!)).toEqual({
      kind: 'search', period: PERIOD, boardId: '188', boardName: '게시판188', position: 2, count: 2, searchExtended: true,
    })
  })

  it('probes the whole period once every such board is searched, and is done when the probe is', () => {
    const searched = [feed('189', 1, { complete: true }), feed('205', 2, { horizonReached: true, searchFinished: true })]
    expect(stage(...searched)).toEqual({ kind: 'probe', period: PERIOD })
    expect(stage(...searched.map((row) => ({ ...row, probeFinished: true })))).toEqual({ kind: 'done', period: PERIOD })
  })

  it('searches nothing for a whole-cafe job, which has no board to search', () => {
    const cafe = { ...feed('0', 1, { horizonReached: true }), feed: { feedKind: 'all_articles' as const, menuId: '0' }, queueOrder: null }
    expect(stage(cafe)).toEqual({ kind: 'probe', period: PERIOD })
  })
})
