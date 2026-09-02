import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Shared across article-collection runs and member-collection runs.
 * Lives in its own file so neither schema can create a circular dependency
 * by importing the other's module while the other is still initializing.
 */
export const collectionRunStatus = pgEnum('collection_run_status', ['running', 'succeeded', 'partial', 'failed', 'interrupted'])
