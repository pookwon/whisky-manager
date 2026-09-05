import type { CollectionFeedKind, StoredFeedState } from './collection-db/repository.js'

/**
 * The job as one thing, read from however many rows hold it.
 *
 * A whole-cafe job is one row. A board job is one row per board, all sharing a
 * period, each with its own cursor. Everyone who asks "is there a job, is it
 * done, is it forced" — the scheduler, the screens, the start button — asks
 * this, so the rows can never be read two ways.
 */
export interface JobDescription {
  readonly scope: CollectionFeedKind
  readonly targetStartMs: number
  readonly targetEndMs: number
  /** In walking order. */
  readonly feeds: readonly StoredFeedState[]
  /** Nothing left that a run could advance: each feed is done or beyond reach. */
  readonly complete: boolean
  readonly forced: boolean
  /** The feeds a block would walk next, in order. */
  readonly remaining: readonly StoredFeedState[]
}

function settled(feed: StoredFeedState): boolean {
  return feed.complete || feed.horizonReached
}

export function describeJob(rows: readonly StoredFeedState[]): JobDescription | null {
  const boardRows = rows.filter((row) => row.feed.feedKind === 'board')
  const feeds =
    boardRows.length > 0
      ? [...boardRows].sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0))
      : rows.filter((row) => row.feed.feedKind === 'all_articles')
  const first = feeds[0]
  if (first === undefined) return null
  return {
    scope: first.feed.feedKind,
    targetStartMs: first.targetStartMs,
    targetEndMs: first.targetEndMs,
    feeds,
    complete: feeds.every(settled),
    forced: feeds.some((feed) => feed.forced),
    remaining: feeds.filter((feed) => !settled(feed)),
  }
}
