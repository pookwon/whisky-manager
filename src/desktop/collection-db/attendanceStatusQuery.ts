import { desc, eq } from 'drizzle-orm'
import type { AttendanceKind, AttendancePeriod } from '../../shared/attendanceTitle.js'
import type { CollectionDatabase } from './client.js'
import { attendancePosts } from './attendanceSchema.js'

/** Reported for every kind, in this order, even one no round has rewarded yet. */
const KINDS: readonly AttendanceKind[] = ['comment', 'post', 'visit']

export interface AttendanceKindStatus {
  readonly kind: AttendanceKind
  readonly roundCount: number
  readonly awardCount: number
  readonly earliest: AttendancePeriod | null
  readonly latest: AttendancePeriod | null
}

export interface AttendanceRefusedPost {
  readonly postId: string
  readonly title: string
  readonly rule: string
}

export interface AttendanceStatus {
  /** Always three, in the order comment, post, visit. */
  readonly kinds: readonly AttendanceKindStatus[]
  /** Newest post first. */
  readonly refused: readonly AttendanceRefusedPost[]
  readonly lastReadAtMs: number | null
}

export interface AttendanceStatusQuery {
  read(): Promise<AttendanceStatus>
}

interface KindAccumulator {
  roundCount: number
  awardCount: number
  earliest: AttendancePeriod | null
  latest: AttendancePeriod | null
}

/** Days are YYYY-MM-DD, so lexical order is chronological. */
function extend(accumulator: KindAccumulator, period: AttendancePeriod, awards: number): void {
  accumulator.roundCount += 1
  accumulator.awardCount += awards
  if (accumulator.earliest === null || period.startDay < accumulator.earliest.startDay) accumulator.earliest = period
  if (accumulator.latest === null || period.startDay > accumulator.latest.startDay) accumulator.latest = period
}

/**
 * The read side for the attendance screen. It folds the recorded rounds into one
 * row per kind — how many rounds, how many awards across them, the earliest and
 * latest period each reaches — and lists the posts read and refused so the
 * operator sees what the parser could not turn into awards.
 */
export function createAttendanceStatusQuery(db: CollectionDatabase): AttendanceStatusQuery {
  return {
    async read() {
      const [rounds, refusedRows, lastReadRows] = await Promise.all([
        db
          .select({
            kind: attendancePosts.kind,
            periodStart: attendancePosts.periodStart,
            periodEnd: attendancePosts.periodEnd,
            winnerCount: attendancePosts.winnerCount,
          })
          .from(attendancePosts)
          .where(eq(attendancePosts.status, 'recorded')),
        db
          .select({ postId: attendancePosts.postId, title: attendancePosts.title, rule: attendancePosts.refusalRule })
          .from(attendancePosts)
          .where(eq(attendancePosts.status, 'refused'))
          .orderBy(desc(attendancePosts.postedAt)),
        db
          .select({ readAt: attendancePosts.readAt })
          .from(attendancePosts)
          .orderBy(desc(attendancePosts.readAt))
          .limit(1),
      ])

      const accumulators = new Map<AttendanceKind, KindAccumulator>(
        KINDS.map((kind) => [kind, { roundCount: 0, awardCount: 0, earliest: null, latest: null }]),
      )
      for (const round of rounds) {
        // A recorded row always carries both period days and a winner count;
        // the schema's recorded check guarantees it.
        if (round.periodStart === null || round.periodEnd === null) continue
        const accumulator = accumulators.get(round.kind)
        if (accumulator === undefined) continue
        extend(accumulator, { startDay: round.periodStart, endDay: round.periodEnd }, round.winnerCount ?? 0)
      }

      return {
        kinds: KINDS.map((kind) => {
          const accumulator = accumulators.get(kind) ?? { roundCount: 0, awardCount: 0, earliest: null, latest: null }
          return {
            kind,
            roundCount: accumulator.roundCount,
            awardCount: accumulator.awardCount,
            earliest: accumulator.earliest,
            latest: accumulator.latest,
          }
        }),
        refused: refusedRows.map((row) => ({ postId: row.postId, title: row.title, rule: row.rule ?? '' })),
        lastReadAtMs: lastReadRows[0]?.readAt.getTime() ?? null,
      }
    },
  }
}
