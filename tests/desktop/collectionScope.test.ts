import { describe, expect, it } from 'vitest'
import { describeJob } from '../../src/desktop/collectionScope.js'
import type { StoredFeedState } from '../../src/desktop/collection-db/repository.js'

function row(over: Partial<StoredFeedState> & { menuId: string; feedKind?: 'all_articles' | 'board' }): StoredFeedState {
  return {
    feed: { feedKind: over.feedKind ?? 'board', menuId: over.menuId },
    stateVersion: 0, anchorPostId: null, anchorPostedAtMs: null, referencePage: null, pageIdentity: null,
    cursorUpdatedAtMs: 0, targetStartMs: 100, targetEndMs: 200,
    complete: false, forced: false, horizonReached: false, queueOrder: null, boardName: null,
    ...over,
  }
}

describe('describeJob', () => {
  it('is null when nothing has been asked for', () => {
    expect(describeJob([])).toBeNull()
  })

  it('reads a whole-cafe job from its single row', () => {
    const job = describeJob([row({ feedKind: 'all_articles', menuId: '0', complete: true })])
    expect(job).toMatchObject({ scope: 'all_articles', complete: true, remaining: [] })
  })

  it('orders board rows by queue and lists what is left to walk', () => {
    const job = describeJob([
      row({ menuId: '205', queueOrder: 3 }),
      row({ menuId: '137', queueOrder: 1, complete: true }),
      row({ menuId: '189', queueOrder: 2, horizonReached: true }),
    ])
    expect(job?.feeds.map((f) => f.feed.menuId)).toEqual(['137', '189', '205'])
    expect(job?.remaining.map((f) => f.feed.menuId)).toEqual(['205'])
    expect(job?.complete).toBe(false)
  })

  it('is complete when every board is done or beyond the cafe horizon, and forced when any row is', () => {
    const job = describeJob([
      row({ menuId: '137', queueOrder: 1, complete: true }),
      row({ menuId: '189', queueOrder: 2, horizonReached: true, forced: true }),
    ])
    expect(job).toMatchObject({ complete: true, forced: true })
  })

  it('prefers the board job when both kinds of row are present', () => {
    // Replacing deletes the other kind, so this is a repair path rather than
    // a state the app produces; the board rows are the newer intent.
    const job = describeJob([row({ feedKind: 'all_articles', menuId: '0' }), row({ menuId: '137', queueOrder: 1 })])
    expect(job?.scope).toBe('board')
  })
})
