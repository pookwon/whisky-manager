import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
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

export const boardKind = pgEnum('collection_board_kind', ['normal', 'memo', 'special', 'unknown'])
export const postedPrecision = pgEnum('collection_posted_precision', ['day', 'minute', 'millisecond'])
export const metricSource = pgEnum('collection_metric_source', ['list', 'detail'])
export const collectionRunStatus = pgEnum('collection_run_status', ['running', 'succeeded', 'partial', 'failed', 'interrupted'])
export const collectionRunKind = pgEnum('collection_run_kind', ['development', 'backfill', 'incremental'])
export const collectionFeedKind = pgEnum('collection_feed_kind', ['all_articles'])

const observedTimestamp = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

export const collectionRuns = pgTable(
  'collection_runs',
  {
    id: uuid('id').primaryKey(),
    cafeId: text('cafe_id').notNull(),
    feedKind: collectionFeedKind('feed_kind').notNull(),
    menuId: text('menu_id').notNull(),
    runKind: collectionRunKind('run_kind').notNull(),
    resumeFromCheckpoint: boolean('resume_from_checkpoint').notNull().default(false),
    targetStartMs: bigint('target_start_ms', { mode: 'number' }).notNull(),
    targetEndMs: bigint('target_end_ms', { mode: 'number' }).notNull(),
    status: collectionRunStatus('status').notNull().default('running'),
    stopReason: text('stop_reason'),
    startedAt: observedTimestamp('started_at').notNull(),
    finishedAt: observedTimestamp('finished_at'),
    discoveryPages: integer('discovery_pages').notNull().default(0),
    collectionPages: integer('collection_pages').notNull().default(0),
    requestPages: integer('request_pages').notNull().default(0),
    observedPostCount: integer('observed_post_count').notNull().default(0),
    inRangePostCount: integer('in_range_post_count').notNull().default(0),
    insertedPostCount: integer('inserted_post_count').notNull().default(0),
    updatedPostCount: integer('updated_post_count').notNull().default(0),
    duplicatePostCount: integer('duplicate_post_count').notNull().default(0),
    failedPostCount: integer('failed_post_count').notNull().default(0),
    lastCommittedAnchorPostId: text('last_committed_anchor_post_id'),
    lastCommittedPage: integer('last_committed_page'),
  },
  (table) => [
    uniqueIndex('collection_runs_one_running_feed').on(table.cafeId, table.feedKind, table.menuId).where(sql`${table.status} = 'running'`),
    index('collection_runs_feed_status').on(table.cafeId, table.feedKind, table.menuId, table.status),
    check('collection_runs_target_range', sql`${table.targetStartMs} < ${table.targetEndMs}`),
    check('collection_runs_last_page', sql`${table.lastCommittedPage} is null or ${table.lastCommittedPage} >= 1`),
    check(
      'collection_runs_nonnegative_counts',
      sql`${table.discoveryPages} >= 0 and ${table.collectionPages} >= 0 and ${table.requestPages} >= 0 and ${table.observedPostCount} >= 0 and ${table.inRangePostCount} >= 0 and ${table.insertedPostCount} >= 0 and ${table.updatedPostCount} >= 0 and ${table.duplicatePostCount} >= 0 and ${table.failedPostCount} >= 0`,
    ),
  ],
)

export const cafeBoards = pgTable(
  'cafe_boards',
  {
    cafeId: text('cafe_id').notNull(),
    boardId: text('board_id').notNull(),
    name: text('name').notNull(),
    kind: boardKind('kind').notNull().default('unknown'),
    collectEnabled: boolean('collect_enabled').notNull().default(true),
    discoveredAt: observedTimestamp('discovered_at').notNull(),
    lastSeenAt: observedTimestamp('last_seen_at').notNull(),
    retiredAt: observedTimestamp('retired_at'),
  },
  (table) => [primaryKey({ columns: [table.cafeId, table.boardId], name: 'cafe_boards_pkey' })],
)

export const cafePosts = pgTable(
  'cafe_posts',
  {
    cafeId: text('cafe_id').notNull(),
    postId: text('post_id').notNull(),
    boardId: text('board_id').notNull(),
    title: text('title'),
    prefix: text('prefix'),
    authorNickname: text('author_nickname'),
    /** Internal-only raw member key; export code must anonymize it later. */
    authorId: text('author_id'),
    postedDateKst: date('posted_date_kst', { mode: 'string' }).notNull(),
    postedAt: observedTimestamp('posted_at'),
    postedPrecision: postedPrecision('posted_precision').notNull(),
    firstSeenAt: observedTimestamp('first_seen_at').notNull(),
    lastSeenAt: observedTimestamp('last_seen_at').notNull(),
    lastObservedRunId: uuid('last_observed_run_id').references(() => collectionRuns.id),
    unavailableAt: observedTimestamp('unavailable_at'),
  },
  (table) => [
    primaryKey({ columns: [table.cafeId, table.postId], name: 'cafe_posts_pkey' }),
    foreignKey({
      name: 'cafe_posts_board_fk',
      columns: [table.cafeId, table.boardId],
      foreignColumns: [cafeBoards.cafeId, cafeBoards.boardId],
    }),
    index('cafe_posts_board_date').on(table.cafeId, table.boardId, table.postedDateKst),
    index('cafe_posts_author_date').on(table.cafeId, table.authorId, table.postedDateKst),
    index('cafe_posts_prefix_date').on(table.cafeId, table.prefix, table.postedDateKst),
  ],
)

export const postMetricObservations = pgTable(
  'post_metric_observations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    cafeId: text('cafe_id').notNull(),
    postId: text('post_id').notNull(),
    observedAt: observedTimestamp('observed_at').notNull(),
    viewCount: bigint('view_count', { mode: 'number' }),
    likeCount: bigint('like_count', { mode: 'number' }),
    commentCount: bigint('comment_count', { mode: 'number' }),
    collectionRunId: uuid('collection_run_id').notNull().references(() => collectionRuns.id),
    source: metricSource('source').notNull(),
    parserVersion: text('parser_version').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'post_metric_observations_post_fk',
      columns: [table.cafeId, table.postId],
      foreignColumns: [cafePosts.cafeId, cafePosts.postId],
    }),
    uniqueIndex('post_metric_observations_run_post_source').on(table.collectionRunId, table.cafeId, table.postId, table.source),
    index('post_metric_observations_post_observed').on(table.cafeId, table.postId, table.observedAt),
  ],
)

export const collectionFeedState = pgTable(
  'collection_feed_state',
  {
    cafeId: text('cafe_id').notNull(),
    feedKind: collectionFeedKind('feed_kind').notNull(),
    menuId: text('menu_id').notNull(),
    targetStartMs: bigint('target_start_ms', { mode: 'number' }).notNull(),
    targetEndMs: bigint('target_end_ms', { mode: 'number' }).notNull(),
    pageSize: integer('page_size').notNull().default(50),
    stateVersion: integer('state_version').notNull().default(0),
    anchorPostId: text('anchor_post_id'),
    anchorPostedDateKst: date('anchor_posted_date_kst', { mode: 'string' }),
    firstPostId: text('first_post_id'),
    lastPostId: text('last_post_id'),
    pageIdentity: text('page_identity'),
    referencePage: integer('reference_page'),
    lastRunId: uuid('last_run_id').references(() => collectionRuns.id),
    updatedAt: observedTimestamp('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cafeId, table.feedKind, table.menuId], name: 'collection_feed_state_pkey' }),
    check('collection_feed_state_version', sql`${table.stateVersion} >= 0`),
    check('collection_feed_state_target_range', sql`${table.targetStartMs} < ${table.targetEndMs}`),
    check('collection_feed_state_page_size', sql`${table.pageSize} between 1 and 50`),
    check('collection_feed_state_reference_page', sql`${table.referencePage} is null or ${table.referencePage} >= 1`),
  ],
)

export const collectionSchema = {
  cafeBoards,
  cafePosts,
  postMetricObservations,
  collectionRuns,
  collectionFeedState,
}
