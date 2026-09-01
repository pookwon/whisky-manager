import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * One cafe per database.
 *
 * The cafe is the database's own scope rather than a column repeated on every
 * row: a second cafe gets a second database, where a cafe column would have to
 * be carried, indexed and joined on forever for a value that never varies. The
 * feed still names itself, because one cafe has several of them — the whole
 * article list, the notices, the recommendations — collected independently.
 */
export const collectionFeedKind = pgEnum('collection_feed_kind', ['all_articles', 'notices', 'recommended'])
export const collectionRunStatus = pgEnum('collection_run_status', ['running', 'succeeded', 'partial', 'failed', 'interrupted'])
export const collectionRunKind = pgEnum('collection_run_kind', ['development', 'backfill', 'incremental'])

/** Every time this schema records is an instant, stored to the millisecond. */
const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

export const collectionRuns = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey(),
    feedKind: collectionFeedKind('feed_kind').notNull(),
    menuId: text('menu_id').notNull(),
    runKind: collectionRunKind('run_kind').notNull(),
    targetStartMs: bigint('target_start_ms', { mode: 'number' }).notNull(),
    targetEndMs: bigint('target_end_ms', { mode: 'number' }).notNull(),
    status: collectionRunStatus('status').notNull().default('running'),
    stopReason: text('stop_reason'),
    startedAt: observedTimestamp('started_at').notNull(),
    finishedAt: observedTimestamp('finished_at'),
    /** Pages spent locating the range, which no stored post came from. */
    discoveryPages: integer('discovery_pages').notNull().default(0),
    /** Pages committed, and every request made — the gap is the rewind reads. */
    collectionPages: integer('collection_pages').notNull().default(0),
    requestPages: integer('request_pages').notNull().default(0),
    observedPostCount: integer('observed_post_count').notNull().default(0),
    insertedPostCount: integer('inserted_post_count').notNull().default(0),
    updatedPostCount: integer('updated_post_count').notNull().default(0),
    lastCommittedPostId: text('last_committed_post_id'),
    lastCommittedPage: integer('last_committed_page'),
  },
  (table) => [
    uniqueIndex('runs_one_running_feed').on(table.feedKind, table.menuId).where(sql`${table.status} = 'running'`),
    index('runs_feed_status').on(table.feedKind, table.menuId, table.status),
    check('runs_target_range', sql`${table.targetStartMs} < ${table.targetEndMs}`),
    check('runs_last_page', sql`${table.lastCommittedPage} is null or ${table.lastCommittedPage} >= 1`),
    check(
      'runs_nonnegative_counts',
      sql`${table.discoveryPages} >= 0 and ${table.collectionPages} >= 0 and ${table.requestPages} >= 0 and ${table.observedPostCount} >= 0 and ${table.insertedPostCount} >= 0 and ${table.updatedPostCount} >= 0`,
    ),
  ],
)

export const boards = pgTable('boards', {
  boardId: text('board_id').primaryKey(),
  name: text('name').notNull(),
  /** The operator's switch for a board whose posts are not worth storing. */
  collectEnabled: boolean('collect_enabled').notNull().default(true),
  firstSeenAt: observedTimestamp('first_seen_at').notNull(),
  lastSeenAt: observedTimestamp('last_seen_at').notNull(),
})

/**
 * A post and its latest reading in one row.
 *
 * The counters live here rather than in a table of their own. Splitting them
 * out only earns its keep when the same post is read many times and the growth
 * between readings is the point; this collection reads a post to know where it
 * stands, so a second table would be one row per post and a join that answers
 * nothing. `snapshotAt` says when the counters were read — an ordinal among
 * readings would say less, and "is this the newest" is always yes with one row.
 */
export const posts = pgTable(
  'posts',
  {
    postId: text('post_id').primaryKey(),
    boardId: text('board_id').notNull().references(() => boards.boardId),
    prefix: text('prefix'),
    title: text('title'),
    /** Internal-only raw member key; export code must anonymize it. */
    authorId: text('author_id'),
    authorNickname: text('author_nickname'),
    postedAt: observedTimestamp('posted_at').notNull(),
    viewCount: bigint('view_count', { mode: 'number' }),
    commentCount: bigint('comment_count', { mode: 'number' }),
    /** When the counters above were read, by the desktop's own clock. */
    snapshotAt: observedTimestamp('snapshot_at').notNull(),
    firstSeenAt: observedTimestamp('first_seen_at').notNull(),
    lastRunId: uuid('last_run_id').references(() => collectionRuns.id),
  },
  (table) => [
    index('posts_posted_at').on(table.postedAt),
    index('posts_board_posted_at').on(table.boardId, table.postedAt),
    index('posts_author_posted_at').on(table.authorId, table.postedAt),
    check(
      'posts_nonnegative_counts',
      sql`(${table.viewCount} is null or ${table.viewCount} >= 0) and (${table.commentCount} is null or ${table.commentCount} >= 0)`,
    ),
  ],
)

/** Where the walk stands, one row per feed. */
export const feedState = pgTable(
  'feed_state',
  {
    feedKind: collectionFeedKind('feed_kind').notNull(),
    menuId: text('menu_id').notNull(),
    targetStartMs: bigint('target_start_ms', { mode: 'number' }).notNull(),
    targetEndMs: bigint('target_end_ms', { mode: 'number' }).notNull(),
    stateVersion: integer('state_version').notNull().default(0),
    /** The oldest post of the last committed page; the cursor's trust source. */
    anchorPostId: text('anchor_post_id'),
    anchorPostedAt: observedTimestamp('anchor_posted_at'),
    pageIdentity: text('page_identity'),
    referencePage: integer('reference_page'),
    lastRunId: uuid('last_run_id').references(() => collectionRuns.id),
    /**
     * When a run reached the period's start, which is the only moment anything
     * knows the job is done. It cannot be worked out from the cursor: the
     * cursor is always the time of a post inside the period, so it never
     * crosses the period's start, and a job derived as finished from it never
     * would be — the scheduler would keep re-searching a finished period every
     * rest period for as long as the app runs.
     */
    completedAt: observedTimestamp('completed_at'),
    /**
     * When the operator asked for this job to ignore the operating hours.
     *
     * It belongs to the job rather than to the schedule because that is what
     * makes it let go of itself: the period it was turned on for finishes, and
     * with it the reason to be reading at three in the morning. A switch in the
     * settings would keep running the next period too, on a night nobody asked
     * about.
     */
    forcedAt: observedTimestamp('forced_at'),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.feedKind, table.menuId], name: 'feed_state_pkey' }),
    check('feed_state_version', sql`${table.stateVersion} >= 0`),
    check('feed_state_target_range', sql`${table.targetStartMs} < ${table.targetEndMs}`),
    check('feed_state_reference_page', sql`${table.referencePage} is null or ${table.referencePage} >= 1`),
  ],
)

export const collectionSchema = {
  boards,
  posts,
  collectionRuns,
  feedState,
}
