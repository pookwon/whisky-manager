import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { collectionRunStatus } from './collectionRunStatus.js'

/**
 * The member list has no board, so the `(feed_kind, menu_id)` identity the
 * article tables carry is not reused. A single-row state table stands in for it,
 * and the run kinds are the member walk's own: a full backfill, an incremental
 * resume, and the daily top-up that adds only new joiners.
 */
export const memberRunKind = pgEnum('member_run_kind', ['backfill', 'incremental', 'topup'])

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

/** One row per member, keyed by the same 43-char key the article list carries as author id. */
export const members = pgTable(
  'members',
  {
    /** Internal-only raw member key; export code must anonymize it. */
    memberKey: text('member_key').primaryKey(),
    nickname: text('nickname'),
    joinDate: date('join_date').notNull(),
    levelName: text('level_name').notNull(),
    isManager: boolean('is_manager').notNull(),
    isStaff: boolean('is_staff').notNull(),
    /** When this row was last read, by the desktop's own clock. */
    snapshotAt: observedTimestamp('snapshot_at').notNull(),
    firstSeenAt: observedTimestamp('first_seen_at').notNull(),
    lastRunId: uuid('last_run_id').references(() => memberRuns.id),
  },
  (table) => [index('members_join_date').on(table.joinDate), index('members_level_name').on(table.levelName)],
)

/**
 * A run against the member walk. One cafe per database and one member feed, so
 * the running-run uniqueness is a whole-table partial index rather than a
 * per-feed one.
 */
export const memberRuns = pgTable(
  'member_runs',
  {
    id: uuid('id').primaryKey(),
    runKind: memberRunKind('run_kind').notNull(),
    status: collectionRunStatus('status').notNull().default('running'),
    stopReason: text('stop_reason'),
    startedAt: observedTimestamp('started_at').notNull(),
    finishedAt: observedTimestamp('finished_at'),
    /** Pages spent relocating the anchor, which no stored member came from. */
    discoveryPages: integer('discovery_pages').notNull().default(0),
    collectionPages: integer('collection_pages').notNull().default(0),
    requestPages: integer('request_pages').notNull().default(0),
    observedMemberCount: integer('observed_member_count').notNull().default(0),
    insertedMemberCount: integer('inserted_member_count').notNull().default(0),
    updatedMemberCount: integer('updated_member_count').notNull().default(0),
    lastCommittedMemberKey: text('last_committed_member_key'),
    lastCommittedPage: integer('last_committed_page'),
  },
  (table) => [
    uniqueIndex('member_runs_one_running').on(table.status).where(sql`${table.status} = 'running'`),
    index('member_runs_status').on(table.status),
    check('member_runs_last_page', sql`${table.lastCommittedPage} is null or ${table.lastCommittedPage} >= 1`),
    check(
      'member_runs_nonnegative_counts',
      sql`${table.discoveryPages} >= 0 and ${table.collectionPages} >= 0 and ${table.requestPages} >= 0 and ${table.observedMemberCount} >= 0 and ${table.insertedMemberCount} >= 0 and ${table.updatedMemberCount} >= 0`,
    ),
  ],
)

/** Where the member walk stands. One cafe per database, so exactly one row, id = 1. */
export const memberFeedState = pgTable(
  'member_feed_state',
  {
    id: integer('id').primaryKey(),
    stateVersion: integer('state_version').notNull().default(0),
    /** The tail member of the last committed page; the cursor. */
    anchorMemberKey: text('anchor_member_key'),
    anchorJoinDate: date('anchor_join_date'),
    referencePage: integer('reference_page'),
    pageIdentity: text('page_identity'),
    /** Total member count at the walk's start, if the response exposes one; progress denominator. */
    totalMemberCount: bigint('total_member_count', { mode: 'number' }),
    /** When a run reached the last page; null while the walk is unfinished. */
    completedAt: observedTimestamp('completed_at'),
    /** When the last new-member top-up finished. */
    toppedUpAt: observedTimestamp('topped_up_at'),
    /** When the operator asked this job to ignore the operating hours. */
    forcedAt: observedTimestamp('forced_at'),
    lastRunId: uuid('last_run_id').references(() => memberRuns.id),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    check('member_feed_state_singleton', sql`${table.id} = 1`),
    check('member_feed_state_version', sql`${table.stateVersion} >= 0`),
    check('member_feed_state_reference_page', sql`${table.referencePage} is null or ${table.referencePage} >= 1`),
    check('member_feed_state_total', sql`${table.totalMemberCount} is null or ${table.totalMemberCount} >= 0`),
  ],
)

export const memberCollectionSchema = { members, memberRuns, memberFeedState }
