import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

export type CollectionDatabase = NodePgDatabase<typeof schema>

export interface CollectionDatabaseConnection {
  readonly db: CollectionDatabase
  close(): Promise<void>
}

export interface OpenCollectionDatabaseOptions {
  /** Main-process-only value. Never pass this through IPC, logs, or errors. */
  readonly databaseUrl: string
  readonly maxConnections?: number
  readonly connectionTimeoutMs?: number
  readonly idleTimeoutMs?: number
}

export class CollectionDatabaseConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CollectionDatabaseConfigError'
  }
}

/** Reads the main-process environment without exposing the URL to callers that do not need it. */
export function collectionDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment.DATABASE_URL?.trim()
  return value === undefined || value === '' ? null : value
}

/**
 * Opens a small pool for collection pages. Callers own `close()` and must call
 * it during Electron shutdown; this module never starts PostgreSQL itself.
 */
export function openCollectionDatabase(options: OpenCollectionDatabaseOptions): CollectionDatabaseConnection {
  if (options.databaseUrl.trim() === '') throw new CollectionDatabaseConfigError('DATABASE_URL is required for collection storage')

  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? 4,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 10_000,
  })
  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}
