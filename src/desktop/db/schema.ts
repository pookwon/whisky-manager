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
    // The hourly cap asks how much went out in the last sixty minutes, once per
    // candidate. Without this the answer costs a scan of every execution ever
    // recorded, and that table only grows.
    index('executions_automation_executed_at').on(table.automationId, table.executedAt),
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
  // Nullable: a board nobody has named yet, which the session refuses on. Adding NOT NULL to an
  // existing SQLite table means rewriting it, which buys nothing here.
  boardId: text('board_id'),
})

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
