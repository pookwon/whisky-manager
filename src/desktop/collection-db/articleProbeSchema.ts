import { sql } from 'drizzle-orm'
import { bigint, check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { collectionRuns } from './schema.js'

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * What reading an id answered. `stored`: a live post of a collected board, now
 * in `posts`. `other_board`: a live post of a board this app does not collect.
 * `deleted`: the cafe's 4003. `unreadable`: a refusal code the capture knows —
 * 0004, a per-board restriction of this read (937311 on board 207 answers it
 * while the list walk stores that post). `notice`: a live notice, never stored,
 * since the list walks never store one and it would be the only notice in `posts`.
 */
export const articleProbeOutcome = pgEnum('article_probe_outcome', ['stored', 'deleted', 'unreadable', 'other_board', 'notice'])

/**
 * The ids the search could not reach, one row each. Filled once per window from
 * the holes between the window's first and last stored post; answered ids keep
 * their answer when a later window spans them — a deleted post does not come back
 * and a stored one is kept current by the walks that re-read it. The id is numeric
 * here, unlike `posts.post_id`: the walk goes in id order, and as text 99999 would
 * sort after 100000.
 */
export const articleProbe = pgTable(
  'article_probe',
  {
    postId: bigint('post_id', { mode: 'number' }).primaryKey(),
    /** KST `yyyymmdd`: the pipeline period this job covers; `to` is the exclusive end — ids come from posts before that day's 00:00 KST. Filled once per window. */
    windowFromDay: text('window_from_day').notNull(),
    windowToDay: text('window_to_day').notNull(),
    /** Null until the id is answered. */
    outcome: articleProbeOutcome('outcome'),
    /** The board the answer named; for `stored`, `other_board` and `notice` only. No reference: another board may be unknown to `boards`. */
    boardId: text('board_id'),
    /** The cafe's code for an `unreadable` id. */
    errorCode: text('error_code'),
    probedAt: observedTimestamp('probed_at'),
    runId: uuid('run_id').references(() => collectionRuns.id),
  },
  (table) => [
    check('article_probe_id', sql`${table.postId} >= 1`),
    check('article_probe_window', sql`${table.windowFromDay} <= ${table.windowToDay}`),
    check('article_probe_answered', sql`(${table.outcome} is null) = (${table.probedAt} is null) and (${table.outcome} is null) = (${table.runId} is null)`),
    check('article_probe_board', sql`case when ${table.outcome} in ('stored', 'other_board', 'notice') then ${table.boardId} is not null else ${table.boardId} is null end`),
    check('article_probe_error_code', sql`case when ${table.outcome} = 'unreadable' then ${table.errorCode} is not null else ${table.errorCode} is null end`),
  ],
)
