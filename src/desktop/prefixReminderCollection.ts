import type { BoardPageFetcher } from './collectionOrchestrator.js'
import type { DayCollector } from './collection.js'
import type { CollectedPostMetadata } from '../shared/cafeArticleList.js'
import { kstDayRange } from '../shared/kst.js'
import { comparePostId } from '../shared/postId.js'
import type { Random } from '../shared/ports.js'
import type { RawCandidate } from '../shared/protocol.js'
import { nextPageFetchDelayMs } from '../shared/schedule.js'
import {
  classifyPost,
  emptyTally,
  tallyOne,
  type EligibilityRules,
  type EligibilityTally,
} from '../shared/automations/prefix-reminder/eligibility.js'

export interface TodayArticleCollectorDeps {
  /** The whole-cafe list, built with `createBoardPageFetcher(transport, newRequestId, '0')`. */
  readonly fetcher: BoardPageFetcher
  readonly rules: EligibilityRules
  readonly random: Random
  readonly sleep: (ms: number) => Promise<void>
  /** Reports, once per day walked, what was read and why posts were dropped. */
  readonly onTally?: (dayStartMs: number, tally: EligibilityTally) => void
}

/**
 * A day walk is a handful of pages on a busy board and one on a quiet one. Far
 * past that means the walk is not ending where it should — a stall or a shape
 * change — so it is worth a line in the log rather than reading on in silence.
 */
const PAGES_WARNING_THRESHOLD = 20

/**
 * Today's ineligible-free posts, newest board first, oldest post first out.
 *
 * Unlike the greeting collector this reads the whole-cafe list rather than one
 * memo board, and decides eligibility from the list row as it goes: a post with
 * a prefix, on an excluded board, or by staff never becomes a candidate. The
 * walk ends when a page reaches into yesterday, repeats the previous page, or
 * comes back empty — the same three endings the list itself can give.
 */
export function createTodayArticleCollector(deps: TodayArticleCollectorDeps): DayCollector {
  return async (dayStartMs, onProgress) => {
    const day = kstDayRange(dayStartMs)
    const eligible = new Map<string, RawCandidate>()
    let tally = emptyTally()
    let lastIdentity: string | null = null

    for (let pageNumber = 1; ; pageNumber += 1) {
      if (pageNumber > PAGES_WARNING_THRESHOLD) {
        console.warn(`[prefix-reminder] day walk exceeded ${PAGES_WARNING_THRESHOLD} pages`)
      }
      let page
      try {
        page = await deps.fetcher.read(pageNumber)
      } catch {
        return null
      }
      if (page.items.length === 0 || page.pageIdentity === lastIdentity) break
      lastIdentity = page.pageIdentity

      let reachedYesterday = false
      for (const item of page.items) {
        if (item.postedAt < day.startMs) {
          reachedYesterday = true
          continue
        }
        if (item.postedAt >= day.endMs) continue
        const verdict = classifyPost(item, deps.rules)
        tally = tallyOne(tally, verdict)
        if (verdict === 'ELIGIBLE') eligible.set(item.postId, toRawCandidate(item))
      }
      onProgress?.(pageNumber, eligible.size)
      if (reachedYesterday) break
      await deps.sleep(nextPageFetchDelayMs(deps.random))
    }

    deps.onTally?.(dayStartMs, tally)
    return [...eligible.values()].sort((a, b) => comparePostId(a.postId, b.postId))
  }
}

/**
 * The list row carries everything a reminder needs — it never reads the post
 * body — so `bodyText` is always null here.
 */
export function toRawCandidate(post: CollectedPostMetadata): RawCandidate {
  return {
    boardId: post.boardId,
    postId: post.postId,
    title: post.title,
    bodyText: null,
    authorNickname: post.authorNickname,
    authorId: post.authorId,
    postedAt: post.postedAt,
    commentCount: post.commentCount,
    prefix: post.prefix,
  }
}
