import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { ExecutionStatus, ExecutionStrategy } from '../../shared/types.js'

/**
 * One post is one row for its whole life. The approval queue is a status, not a
 * separate table, so history and queue can never disagree.
 */
export const executions = sqliteTable(
  'executions',
  {
    id: text('id').primaryKey(),
    automationId: text('automation_id').notNull(),
    cafeId: text('cafe_id').notNull(),
    boardId: text('board_id').notNull(),
    targetPostId: text('target_post_id').notNull(),
    targetTitle: text('target_title'),
    targetAuthor: text('target_author'),
    targetAuthorId: text('target_author_id'),
    targetPostedAt: integer('target_posted_at').notNull(),
    actorAccount: text('actor_account'),
    status: text('status').$type<ExecutionStatus>().notNull(),
    strategy: text('strategy').$type<ExecutionStrategy>(),
    riskFlags: text('risk_flags').notNull().default('[]'),
    reason: text('reason'),
    templateId: text('template_id'),
    renderedText: text('rendered_text'),
    attempts: integer('attempts').notNull().default(0),
    detectedAt: integer('detected_at').notNull(),
    executedAt: integer('executed_at'),
    resolvedAt: integer('resolved_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    // cafe_id belongs in the key: post ids are numbered per cafe, so without it
    // cafe A's post 1001 and cafe B's post 1001 collide.
    uniqueIndex('executions_cafe_automation_post_unique').on(
      table.cafeId,
      table.automationId,
      table.targetPostId,
    ),
    // Not unique on purpose. `claim` enforces one greeting per author; making
    // the database enforce it would mean deleting rows that already carry a
    // posted comment before the index could be created.
    index('executions_cafe_automation_author').on(
      table.cafeId,
      table.automationId,
      table.targetAuthorId,
    ),
  ],
)

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull(),
  body: text('body').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
})

export const automationSettings = sqliteTable('automation_settings', {
  automationId: text('automation_id').primaryKey(),
  policy: text('policy').notNull(),
  limitsJson: text('limits_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // Nullable: the reader falls back to DEFAULT_BOARD_ID. Adding NOT NULL to an
  // existing SQLite table means rewriting it, which buys nothing here.
  boardId: text('board_id'),
})

export const watermarks = sqliteTable(
  'watermarks',
  {
    automationId: text('automation_id').notNull(),
    cafeId: text('cafe_id').notNull(),
    boardId: text('board_id').notNull(),
    lastSeenPostId: text('last_seen_post_id').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('watermarks_cafe_automation_board_unique').on(
      table.cafeId,
      table.automationId,
      table.boardId,
    ),
  ],
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * Members this tool has watched join. Only what the new-member check needs is
 * kept: the key that joins to a post's author, and the day they joined. The
 * table starts empty and is only ever filled forward, so a member missing from
 * it means they joined before the tool started looking.
 */
export const members = sqliteTable(
  'members',
  {
    cafeId: text('cafe_id').notNull(),
    memberKey: text('member_key').notNull(),
    /** `2026.08.23.` — zero padded, so string order is date order. */
    joinDate: text('join_date').notNull(),
  },
  (table) => [uniqueIndex('members_cafe_member_unique').on(table.cafeId, table.memberKey)],
)
