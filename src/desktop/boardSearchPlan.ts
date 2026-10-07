import { buildBoardSearchDictionary, extendBoardSearchQueries, type BoardSearchQuery } from '../shared/boardSearchDictionary.js'
import { isKstDayKey, kstDayKey } from '../shared/kst.js'
import type { BoardSearchRepository } from './collection-db/boardSearchRepository.js'

export type BoardSearchPlan =
  | { readonly kind: 'ready'; readonly boardId: string; readonly fromDay: string; readonly toDay: string; readonly queries: readonly BoardSearchQuery[] }
  | { readonly kind: 'refused'; readonly reason: 'NO_POSTS' | 'NOTHING_BEFORE' | 'NO_QUERIES' | 'BAD_DAY' }

/**
 * What a search job for this board would be. The window ends on the day of the
 * oldest stored post, read again rather than trimmed: that day is where the
 * list walk stopped, and the part of it the list did not reach is in the gap.
 */
export async function planBoardSearchJob(repository: BoardSearchRepository, input: { readonly boardId: string; readonly fromDay: string }): Promise<BoardSearchPlan> {
  if (!isKstDayKey(input.fromDay)) return { kind: 'refused', reason: 'BAD_DAY' }
  const oldest = await repository.oldestPostedAtMs(input.boardId)
  if (oldest === null) return { kind: 'refused', reason: 'NO_POSTS' }
  const toDay = kstDayKey(oldest)
  if (input.fromDay > toDay) return { kind: 'refused', reason: 'NOTHING_BEFORE' }
  const titles = await repository.readBoardTitles(input.boardId)
  const picked = buildBoardSearchDictionary(titles)
  if (picked.length === 0) return { kind: 'refused', reason: 'NO_QUERIES' }
  // The longer forms go last: the picks are the best order the stored titles
  // give, and the forms only catch what the whole-word match leaves.
  const queries = [...picked, ...extendBoardSearchQueries(titles, picked.map((entry) => entry.query))]
  return { kind: 'ready', boardId: input.boardId, fromDay: input.fromDay, toDay, queries }
}
