import { sql } from 'drizzle-orm'
import { check, date, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { memberRuns } from './memberSchema.js'

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/**
 * Where the periodic member re-walk stands. The first walk and the daily top-up
 * share `member_feed_state`'s cursor, and the top-up rewinds it to page 1 every
 * day; a re-walk that takes a week and a half needs a cursor nothing else
 * moves. One cafe per database, so exactly one row, id = 1.
 */
export const memberResyncState = pgTable(
  'member_resync_state',
  {
    id: integer('id').primaryKey(),
    stateVersion: integer('state_version').notNull().default(0),
    /** The tail member of the last committed page of this cycle; the cursor. */
    anchorMemberKey: text('anchor_member_key'),
    anchorJoinDate: date('anchor_join_date'),
    referencePage: integer('reference_page'),
    pageIdentity: text('page_identity'),
    /** When the current (or last) cycle's first run started. */
    cycleStartedAt: observedTimestamp('cycle_started_at'),
    /** When that cycle reached the last page; null while it is under way. */
    completedAt: observedTimestamp('completed_at'),
    lastRunId: uuid('last_run_id').references(() => memberRuns.id),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    check('member_resync_state_singleton', sql`${table.id} = 1`),
    check('member_resync_state_version', sql`${table.stateVersion} >= 0`),
    check('member_resync_state_reference_page', sql`${table.referencePage} is null or ${table.referencePage} >= 1`),
  ],
)
