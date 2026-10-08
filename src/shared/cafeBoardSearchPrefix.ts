import { fail, optionalNullableString, type CollectedPostMetadata, type JsonRecord } from './cafeArticleList.js'

/**
 * How the board search reports a prefix. It names prefixes only from the
 * searched board's own set, and a post moved in from another board keeps that
 * board's prefix: a non-zero `headId` with no `headName` (seen 2026-10-08:
 * board 137 "면세" answering board-188 posts headed 364 '국내공항면세' and 634
 * '면세퀵턴'). The list and the article read never do this, and their
 * `prefixOf` keeps rejecting such an item.
 */
export interface SearchPrefix {
  readonly prefix: string | null
  /** The item is headed and the search could not name it. */
  readonly unnamed: boolean
}

function isHeaded(item: JsonRecord): boolean {
  return Object.prototype.hasOwnProperty.call(item, 'headId') && item.headId !== null && item.headId !== 0
}

export function searchPrefixOf(item: JsonRecord, path: string): SearchPrefix {
  const headName = optionalNullableString(item, 'headName', path, 'INVALID_ARTICLE')
  if (headName !== undefined) return { prefix: headName, unnamed: false }
  return { prefix: null, unnamed: isHeaded(item) }
}

/**
 * The item-level rename guard, kept at page level: an unnamed headed item is a
 * foreign prefix only while the page shows the field still exists. A page of
 * headed items none of which carries `headName` is the field renamed, and
 * reading it as foreign prefixes would strip every prefix silently.
 */
export function assertPrefixFieldPresent(items: readonly CollectedPostMetadata[]): void {
  const unnamed = items.some((item) => item.prefixUnnamed === true)
  const named = items.some((item) => item.prefixUnnamed === undefined && item.prefix !== null)
  if (unnamed && !named) fail('INVALID_ARTICLE', 'result.articleList[].item.headName is missing for every headed article')
}
