import { sql } from 'drizzle-orm'
import { check, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { boards, collectionRuns } from './schema.js'

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * Where the search backfill stands, one row per query. Every row of a job has
 * the same board and window; making a new job replaces them all. The cursor is
 * a page number: the window ends in the past, so no new post can push the
 * results along underneath it.
 */
export const boardSearchState = pgTable(
  'board_search_state',
  {
    boardId: text('board_id').notNull().references(() => boards.boardId),
    query: text('query').notNull(),
    /** KST `yyyymmdd`, inclusive. */
    fromDay: text('from_day').notNull(),
    /** KST `yyyymmdd`, inclusive. */
    toDay: text('to_day').notNull(),
    /** Fixed when the job is made, so "how far along" means the same thing every day. */
    queueOrder: integer('queue_order').notNull(),
    /** Stored titles the dictionary expected this query to add. */
    expectedGain: integer('expected_gain').notNull(),
    /**
     * KST `yyyymmdd`, inclusive: the end of the window the query is walking now;
     * null means `to_day`. The search serves at most its result cap per window,
     * so a query that fills it walks on in a window ending at its oldest day.
     */
    segmentToDay: text('segment_to_day'),
    lastCommittedPage: integer('last_committed_page'),
    insertedCount: integer('inserted_count').notNull().default(0),
    /** The search's own `totalArticleCount`, written with the first page. */
    totalCount: integer('total_count'),
    lastRunId: uuid('last_run_id').references(() => collectionRuns.id),
    completedAt: observedTimestamp('completed_at'),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.query], name: 'board_search_state_pkey' }),
    check('board_search_state_window', sql`${table.fromDay} <= ${table.toDay}`),
    check('board_search_state_queue_order', sql`${table.queueOrder} >= 1`),
    check('board_search_state_counts', sql`${table.expectedGain} >= 0 and ${table.insertedCount} >= 0 and (${table.totalCount} is null or ${table.totalCount} >= 0)`),
    check('board_search_state_page', sql`${table.lastCommittedPage} is null or ${table.lastCommittedPage} >= 1`),
    check('board_search_state_segment', sql`${table.segmentToDay} is null or (${table.fromDay} <= ${table.segmentToDay} and ${table.segmentToDay} <= ${table.toDay})`),
  ],
)
