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
  readonly statementTimeoutMs?: number
}

/**
 * The heaviest query the app sends runs well under a second. One that has not
 * answered in a minute is stuck, and waiting on it forever would hold a pool
 * connection — and, for a runner, the collection lock — for as long as the app
 * stays up. The server cancels it and the connection goes back to the pool.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000

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
    statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  })
  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}
