import { sql } from 'drizzle-orm'
import { check, date, index, integer, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/** The attendance kind a round rewards; the title's opening bracket decides it. */
export const attendanceKind = pgEnum('attendance_kind', ['comment', 'post', 'visit'])

/**
 * Whether a round's post was turned into stored awards, or read and refused.
 * A refused post is kept so the same post is not read and refused again.
 */
export const attendancePostStatus = pgEnum('attendance_post_status', ['recorded', 'refused'])

/** Every instant this schema records, stored to the millisecond. */
const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * One row per attendance post. A recorded row carries its period, its winner
 * count and awards; a refused row carries only the rule that turned it away and
 * never a period it could not read. The two states are kept apart by a check
 * rather than by two tables, because the only question asked of the row is which
 * one it is.
 */
export const attendancePosts = pgTable(
  'attendance_posts',
  {
    postId: text('post_id').primaryKey(),
    kind: attendanceKind('kind').notNull(),
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    title: text('title').notNull(),
    postedAt: observedTimestamp('posted_at').notNull(),
    /** When the post was read, by the desktop's own clock. */
    readAt: observedTimestamp('read_at').notNull(),
    status: attendancePostStatus('status').notNull(),
    refusalRule: text('refusal_rule'),
    winnerCount: integer('winner_count'),
  },
  (table) => [
    index('attendance_posts_kind_period').on(table.kind, table.periodStart),
    check(
      'attendance_posts_recorded',
      sql`(${table.status} = 'recorded') = (${table.refusalRule} is null and ${table.winnerCount} is not null and ${table.periodStart} is not null and ${table.periodEnd} is not null)`,
    ),
    check('attendance_posts_period_order', sql`${table.periodStart} is null or ${table.periodEnd} is null or ${table.periodStart} <= ${table.periodEnd}`),
  ],
)

/** One row per winning nickname in one round, ordered by its announced position. */
export const attendanceAwards = pgTable(
  'attendance_awards',
  {
    postId: text('post_id').notNull().references(() => attendancePosts.postId, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    nickname: text('nickname').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.position], name: 'attendance_awards_pkey' }),
    index('attendance_awards_nickname').on(table.nickname),
  ],
)

export const attendanceCollectionSchema = { attendancePosts, attendanceAwards }
