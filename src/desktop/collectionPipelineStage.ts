import { kstDayKey } from '../shared/kst.js'
import type { JobDescription } from './collectionScope.js'

/** KST `yyyymmdd` days of the period; `toDay` is the exclusive end, the day after the last. */
export interface CollectionPeriodDays {
  readonly fromDay: string
  readonly toDay: string
}

export type CollectionPipelineStage =
  /** No period has been asked for. */
  | { readonly kind: 'idle' }
  | { readonly kind: 'list'; readonly period: CollectionPeriodDays }
  | {
      readonly kind: 'search'
      readonly period: CollectionPeriodDays
      readonly boardId: string
      readonly boardName: string | null
      /** 1-based, among the boards the list could not finish, in queue order. */
      readonly position: number
      readonly count: number
      readonly searchExtended: boolean
    }
  | { readonly kind: 'probe'; readonly period: CollectionPeriodDays }
  | { readonly kind: 'done'; readonly period: CollectionPeriodDays }

export function collectionPeriodDays(job: JobDescription): CollectionPeriodDays {
  return { fromDay: kstDayKey(job.targetStartMs), toDay: kstDayKey(job.targetEndMs) }
}

/**
 * Where a collection stands, in the order it goes: ① the list until every
 * board is finished or beyond reach, ② the search of each board the list
 * could not finish, ③ the article id holes of the whole period. Read off the
 * job's rows alone, so the loop, the pipeline and the screen cannot disagree.
 */
export function collectionPipelineStage(job: JobDescription | null): CollectionPipelineStage {
  if (job === null) return { kind: 'idle' }
  const period = collectionPeriodDays(job)
  if (!job.complete) return { kind: 'list', period }
  // Only a board list has a board to search; the whole-cafe list goes straight on.
  const beyondReach = job.feeds.filter((feed) => feed.feed.feedKind === 'board' && feed.horizonReached)
  const index = beyondReach.findIndex((feed) => !feed.searchFinished)
  const board = beyondReach[index]
  if (board !== undefined) {
    return {
      kind: 'search', period, boardId: board.feed.menuId, boardName: board.boardName,
      position: index + 1, count: beyondReach.length, searchExtended: board.searchExtended,
    }
  }
  return job.feeds.every((feed) => feed.probeFinished) ? { kind: 'done', period } : { kind: 'probe', period }
}
