import { sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'
import { posts } from './schema.js'

export interface MemberCollectionStatus {
  readonly memberCount: number
  /** Pages of the list the walk has reached — see `walkPagesStored`. */
  readonly pagesStored: number
  readonly totalMemberCount: number | null
  readonly complete: boolean
  readonly forced: boolean
  readonly completedAtMs: number | null
  readonly toppedUpAtMs: number | null
  readonly running: boolean
  /** Distinct post authors, and how many of them exist in the member table. */
  readonly authorCount: number
  readonly matchedAuthorCount: number
  /** Status of the most recent run, or null when no run has ever started. */
  readonly lastRunStatus: string | null
  /** Stop reason of the most recent run, or null when none was recorded. */
  readonly lastRunStopReason: string | null
}

export interface MemberCollectionStatusQuery {
  read(): Promise<MemberCollectionStatus>
}

function count(value: string | number | null | undefined): number {
  return Number(value ?? 0)
}

/**
 * How far through the list the walk is.
 *
 * Until the walk completes, the cursor belongs to it alone — top-ups only run
 * after completion — so its page is the walk's position, and a restarted walk
 * reads from page 1 again instead of inheriting an earlier walk's high-water
 * mark. Once complete, the cursor is reset to page 1 by every daily top-up, so
 * the figure comes from the furthest page any walk committed instead.
 */
export function walkPagesStored(state: {
  readonly complete: boolean
  readonly referencePage: number | null
  readonly maxCommittedWalkPage: number
}): number {
  if (!state.complete) return state.referencePage ?? 0
  return state.maxCommittedWalkPage
}

function epochMs(value: Date | null | undefined): number | null {
  return value === null || value === undefined ? null : value.getTime()
}

export function createMemberCollectionStatusQuery(db: CollectionDatabase): MemberCollectionStatusQuery {
  return {
    async read() {
      const [memberTotals, stateRows, runningRows, lastRunRows, walkPages, match] = await Promise.all([
        db.select({ members: sql<string>`count(*)` }).from(members),
        db
          .select({
            totalMemberCount: memberFeedState.totalMemberCount,
            referencePage: memberFeedState.referencePage,
            completedAt: memberFeedState.completedAt,
            toppedUpAt: memberFeedState.toppedUpAt,
            forcedAt: memberFeedState.forcedAt,
          })
          .from(memberFeedState)
          .limit(1),
        db.select({ running: sql<string>`count(*)` }).from(memberRuns).where(sql`${memberRuns.status} = 'running'`),
        // Most recent run for its status and stop reason.
        db
          .select({ status: memberRuns.status, stopReason: memberRuns.stopReason })
          .from(memberRuns)
          .orderBy(sql`${memberRuns.startedAt} desc`)
          .limit(1),
        // The furthest page any walk committed; used once the walk is complete.
        db
          .select({ maxPage: sql<string>`max(${memberRuns.lastCommittedPage})` })
          .from(memberRuns)
          .where(sql`${memberRuns.runKind} != 'topup'`),
        // Distinct post authors and how many exist in members. A low match ratio
        // is the health signal that the key contract changed.
        db.execute<{ authors: string; matched: string }>(sql`
          select
            count(distinct ${posts.authorId}) as authors,
            count(distinct ${posts.authorId}) filter (where ${members.memberKey} is not null) as matched
          from ${posts}
          left join ${members} on ${members.memberKey} = ${posts.authorId}
          where ${posts.authorId} is not null
        `),
      ])

      const state = stateRows[0]
      const lastRun = lastRunRows[0] ?? null
      const matchRow = match.rows[0]
      return {
        memberCount: count(memberTotals[0]?.members),
        pagesStored: walkPagesStored({
          complete: state?.completedAt != null,
          referencePage: state?.referencePage ?? null,
          maxCommittedWalkPage: count(walkPages[0]?.maxPage),
        }),
        totalMemberCount: state?.totalMemberCount ?? null,
        complete: state?.completedAt != null,
        forced: state?.forcedAt != null,
        completedAtMs: epochMs(state?.completedAt ?? null),
        toppedUpAtMs: epochMs(state?.toppedUpAt ?? null),
        running: count(runningRows[0]?.running) > 0,
        authorCount: count(matchRow?.authors),
        matchedAuthorCount: count(matchRow?.matched),
        lastRunStatus: lastRun?.status ?? null,
        lastRunStopReason: lastRun?.stopReason ?? null,
      }
    },
  }
}
