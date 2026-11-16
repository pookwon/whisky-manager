import { eq } from 'drizzle-orm'
import type { AttendanceKind, AttendancePeriod } from '../../shared/attendanceTitle.js'
import type { CollectionDatabase } from './client.js'
import { attendanceAwards, attendancePosts } from './attendanceSchema.js'

/**
 * One insert of 8,000 awards × 3 parameters stays under PostgreSQL's 65,535
 * bound-parameter limit, but the chunk keeps a single statement small enough to
 * plan and log cheaply for the rare giant round.
 */
const AWARD_INSERT_CHUNK_SIZE = 1_000

export interface AttendancePostRecord {
  readonly postId: string
  readonly kind: AttendanceKind
  readonly period: AttendancePeriod | null
  readonly title: string
  readonly postedAt: Date
}

/**
 * The write side of the attendance collection. Every save is one post row and
 * the full set of its awards, written atomically: a round the extension reads
 * again overwrites what it stored before rather than piling a second copy on it.
 */
export interface AttendanceRepository {
  /** The posts already turned into awards, so the walk skips reading them again. */
  recordedPostIds(): Promise<ReadonlySet<string>>
  saveRecorded(post: AttendancePostRecord & { readonly period: AttendancePeriod }, nicknames: readonly string[], readAt: Date): Promise<void>
  saveRefused(post: AttendancePostRecord, rule: string, readAt: Date): Promise<void>
}

export function createAttendanceRepository(db: CollectionDatabase): AttendanceRepository {
  /** Upsert the post and replace its awards in one transaction. */
  async function replace(values: typeof attendancePosts.$inferInsert, nicknames: readonly string[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .insert(attendancePosts)
        .values(values)
        .onConflictDoUpdate({
          target: attendancePosts.postId,
          set: {
            kind: values.kind,
            periodStart: values.periodStart,
            periodEnd: values.periodEnd,
            title: values.title,
            postedAt: values.postedAt,
            readAt: values.readAt,
            status: values.status,
            refusalRule: values.refusalRule,
            winnerCount: values.winnerCount,
          },
        })
      await tx.delete(attendanceAwards).where(eq(attendanceAwards.postId, values.postId))
      for (let start = 0; start < nicknames.length; start += AWARD_INSERT_CHUNK_SIZE) {
        const chunk = nicknames.slice(start, start + AWARD_INSERT_CHUNK_SIZE)
        await tx.insert(attendanceAwards).values(
          chunk.map((nickname, index) => ({ postId: values.postId, position: start + index + 1, nickname })),
        )
      }
    })
  }

  return {
    async recordedPostIds() {
      const rows = await db.select({ postId: attendancePosts.postId }).from(attendancePosts).where(eq(attendancePosts.status, 'recorded'))
      return new Set(rows.map((row) => row.postId))
    },

    async saveRecorded(post, nicknames, readAt) {
      await replace(
        {
          postId: post.postId,
          kind: post.kind,
          periodStart: post.period.startDay,
          periodEnd: post.period.endDay,
          title: post.title,
          postedAt: post.postedAt,
          readAt,
          status: 'recorded',
          refusalRule: null,
          winnerCount: nicknames.length,
        },
        nicknames,
      )
    },

    async saveRefused(post, rule, readAt) {
      await replace(
        {
          postId: post.postId,
          kind: post.kind,
          periodStart: post.period?.startDay ?? null,
          periodEnd: post.period?.endDay ?? null,
          title: post.title,
          postedAt: post.postedAt,
          readAt,
          status: 'refused',
          refusalRule: rule,
          winnerCount: null,
        },
        [],
      )
    },
  }
}
