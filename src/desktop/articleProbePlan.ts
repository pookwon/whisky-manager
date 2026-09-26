import type { BoardSearchQueryState } from './collection-db/boardSearchRepository.js'

export type ArticleProbeWindow =
  | { readonly kind: 'ready'; readonly fromDay: string; readonly toDay: string }
  | { readonly kind: 'refused'; readonly reason: 'NO_SEARCH_JOB' | 'SEARCH_NOT_FINISHED' }

/**
 * The window a probe job takes: the search job's, and only once every query of
 * it has finished. The ids to read are what the search left, so they are known
 * only when the search is done leaving them.
 */
export function articleProbeWindow(queries: readonly BoardSearchQueryState[]): ArticleProbeWindow {
  const first = queries[0]
  if (first === undefined) return { kind: 'refused', reason: 'NO_SEARCH_JOB' }
  if (!queries.every((query) => query.complete)) return { kind: 'refused', reason: 'SEARCH_NOT_FINISHED' }
  return { kind: 'ready', fromDay: first.fromDay, toDay: first.toDay }
}
