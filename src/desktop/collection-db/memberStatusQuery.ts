import { sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'
import { posts } from './schema.js'

export interface MemberCollectionStatus {
  readonly memberCount: number
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
      const [memberTotals, stateRows, runningRows, pagesRows, match] = await Promise.all([
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
        db.select({ pages: sql<string>`coalesce(sum(${memberRuns.collectionPages}), 0)` }).from(memberRuns),
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
      const matchRow = match.rows[0]
      return {
        memberCount: count(memberTotals[0]?.members),
        pagesStored: count(pagesRows[0]?.pages),
        totalMemberCount: state?.totalMemberCount ?? null,
        complete: state?.completedAt != null,
        forced: state?.forcedAt != null,
        completedAtMs: epochMs(state?.completedAt ?? null),
        toppedUpAtMs: epochMs(state?.toppedUpAt ?? null),
        running: count(runningRows[0]?.running) > 0,
        authorCount: count(matchRow?.authors),
        matchedAuthorCount: count(matchRow?.matched),
      }
    },
  }
}
