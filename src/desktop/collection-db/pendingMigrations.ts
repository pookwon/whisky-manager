import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { decideCollectionSchemaState, type CollectionDatabaseFacts, type CollectionMigrationStamp } from './migrationState.js'

/** Anything that can send raw SQL: the app's pooled database or the migration's own client. */
export interface MigrationHistoryReader {
  execute: NodePgDatabase['execute']
}

const UNDEFINED_TABLE = '42P01'
const INVALID_SCHEMA_NAME = '3F000'

/**
 * One key shared by every app instance pointed at the same database, so that
 * only one of them alters it and the others wait, then find it current.
 */
const MIGRATION_LOCK_KEY = 'whisky_manager.collection_migrations'

const MIGRATION_CONNECTION_TIMEOUT_MS = 5_000

/**
 * How long the migration waits for the lock, or for a table a running query
 * holds. An instance stuck behind another must give up and say so rather than
 * leave the app starting forever; the next start tries again.
 */
const MIGRATION_LOCK_TIMEOUT_MS = 120_000

/**
 * The driver's SQLSTATE. drizzle wraps a failed query in its own error and
 * keeps the driver's as `cause`, so the code is looked for along that chain.
 */
function sqlState(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  if ('code' in error) return String((error as { code: unknown }).code)
  return 'cause' in error ? sqlState((error as { cause: unknown }).cause) : null
}

/**
 * The newest migration the database records, or null when it records none —
 * including a database that has never had the `drizzle` schema created.
 */
export async function readAppliedCollectionMigration(
  db: MigrationHistoryReader,
): Promise<CollectionMigrationStamp | null> {
  try {
    const result = await db.execute<{ hash: string; created_at: string }>(
      sql`select hash, created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    )
    const latest = result.rows[0]
    return latest === undefined ? null : { hash: latest.hash, createdAt: Number(latest.created_at) }
  } catch (error) {
    const state = sqlState(error)
    if (state === UNDEFINED_TABLE || state === INVALID_SCHEMA_NAME) return null
    throw error
  }
}

/** Whether anything already lives in `public`, where the migrations create their tables. */
export async function hasPublicTables(db: MigrationHistoryReader): Promise<boolean> {
  const result = await db.execute<{ present: boolean }>(
    sql`select exists (select 1 from pg_tables where schemaname = 'public') as present`,
  )
  return result.rows[0]?.present === true
}

export async function readCollectionDatabaseFacts(db: MigrationHistoryReader): Promise<CollectionDatabaseFacts> {
  return { applied: await readAppliedCollectionMigration(db), hasPublicTables: await hasPublicTables(db) }
}

export interface ApplyPendingCollectionMigrationsOptions {
  /** Main-process-only value. Never pass this through IPC, logs, or errors. */
  readonly databaseUrl: string
  readonly migrationsFolder: string
  readonly journal: readonly CollectionMigrationStamp[]
}

/**
 * Applies the packaged migrations the database does not have yet, and nothing
 * else. Runs on its own connection because a session advisory lock belongs to
 * one connection, and without the app pool's statement timeout because an
 * index over months of posts may take longer than any page query.
 *
 * drizzle's own transaction is not enough between two instances: it reads the
 * latest applied migration before opening it, so both would apply the same
 * files. Under the lock the state is read again, and a database that turned
 * out current — or unknown, because a newer app got there first — is left as
 * it is.
 */
export async function applyPendingCollectionMigrations(
  options: ApplyPendingCollectionMigrationsOptions,
): Promise<void> {
  const client = new Client({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: MIGRATION_CONNECTION_TIMEOUT_MS,
    lock_timeout: MIGRATION_LOCK_TIMEOUT_MS,
  })
  // A dropped connection also rejects the query in flight, which is where the
  // failure is reported; unheard, the event would take down the main process.
  client.on('error', () => undefined)
  await client.connect()
  try {
    // Session-level, so it is released when the connection ends below,
    // whether the migration committed or rolled back.
    await client.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_KEY])
    const db = drizzle(client)
    const state = decideCollectionSchemaState(options.journal, await readCollectionDatabaseFacts(db))
    if (state === 'behind' || state === 'empty') {
      await migrate(db, { migrationsFolder: options.migrationsFolder })
    }
  } finally {
    // A failure to close must not replace the migration's own error.
    await client.end().catch(() => undefined)
  }
}

/**
 * What may be logged about a failed migration: the SQLSTATE or the error's
 * class. Driver messages can carry a host or user name and stay out of logs.
 */
export function describeMigrationFailure(error: unknown): string {
  const state = sqlState(error)
  if (state !== null) return state
  return error instanceof Error ? error.name : 'unknown'
}
