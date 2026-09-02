import { sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'
import { posts } from './schema.js'

export interface MemberCollectionStatus {
  readonly memberCount: number
  /**
   * Pages the walk has processed in the current run, derived from the cursor
   * (`member_feed_state.reference_page`) rather than a lifetime sum, so it
   * does not grow without bound across rewinds and daily top-ups.
   */
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
        // Walk page count from the walk itself, not the shared cursor: the
        // shared cursor resets to 1 on every top-up commit, so reading it
        // after any top-up permanently collapses the stored-pages figure.
        // max(last_committed_page) over non-topup runs is stable once the
        // walk finishes and is not affected by later top-up runs.
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
        // Use the walk's own max page rather than the shared cursor: the cursor
        // resets to 1 on every top-up commit, so it always reads 1 after any
        // daily top-up. max(last_committed_page) over non-topup runs is stable
        // once the walk finishes and is unaffected by subsequent top-ups.
        pagesStored: count(walkPages[0]?.maxPage),
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
