import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { collectionDatabaseUrl, openCollectionDatabase, type CollectionDatabaseConnection } from './collection-db/client.js'
import { createCollectionRepository, type CollectionRepository } from './collection-db/repository.js'
import { createCollectionStatusQuery, type CollectionStatusQuery } from './collection-db/statusQuery.js'

export type CollectionUnavailableCode =
  | 'COLLECTION_CONNECTION_FAILED'
  | 'COLLECTION_AUTHENTICATION_FAILED'
  | 'COLLECTION_SCHEMA_MISSING'
  | 'COLLECTION_SCHEMA_MISMATCH'
  | 'COLLECTION_MIGRATION_FILES_MISSING'

export type OptionalCollectionContext =
  | { readonly kind: 'disabled'; close(): Promise<void> }
  | {
      readonly kind: 'ready'
      readonly repository: CollectionRepository
      /** Reading for the screens, kept apart from the repository that writes pages. */
      readonly status: CollectionStatusQuery
      close(): Promise<void>
    }
  | {
      readonly kind: 'unavailable'
      readonly code: CollectionUnavailableCode
      retry(): Promise<OptionalCollectionContext>
      close(): Promise<void>
    }

const noOpClose = async (): Promise<void> => undefined

class CollectionContextError extends Error {
  constructor(readonly code: CollectionUnavailableCode) {
    super(code)
    this.name = 'CollectionContextError'
  }
}

export function classifyCollectionContextError(error: unknown): CollectionUnavailableCode {
  if (error instanceof CollectionContextError) return error.code
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
  if (code === '28P01' || code === '28000') return 'COLLECTION_AUTHENTICATION_FAILED'
  if (code === '42P01' || code === '3F000') return 'COLLECTION_SCHEMA_MISSING'
  return 'COLLECTION_CONNECTION_FAILED'
}

function expectedMigration(migrationsFolder: string | undefined): { hash: string; createdAt: number } {
  if (migrationsFolder === undefined) {
    throw new CollectionContextError('COLLECTION_MIGRATION_FILES_MISSING')
  }
  try {
    const migrations = readMigrationFiles({ migrationsFolder })
    const latest = migrations.at(-1)
    if (latest === undefined) throw new Error('empty migration journal')
    return { hash: latest.hash, createdAt: latest.folderMillis }
  } catch {
    throw new CollectionContextError('COLLECTION_MIGRATION_FILES_MISSING')
  }
}

/**
 * Collection storage is optional while the existing app remains SQLite-only.
 * This verifies the exact packaged migration and never invokes migrate.
 */
export async function openOptionalCollectionContext(
  environment: NodeJS.ProcessEnv = process.env,
  migrationsFolder?: string,
): Promise<OptionalCollectionContext> {
  const databaseUrl = collectionDatabaseUrl(environment)
  if (databaseUrl === null) return { kind: 'disabled', close: noOpClose }

  let expected: { hash: string; createdAt: number }
  try {
    expected = expectedMigration(migrationsFolder)
  } catch (error) {
    const code = classifyCollectionContextError(error)
    return {
      kind: 'unavailable', code, close: noOpClose,
      retry: () => openOptionalCollectionContext(environment, migrationsFolder),
    }
  }

  let connection: CollectionDatabaseConnection | null = null
  try {
    connection = openCollectionDatabase({ databaseUrl })
    const migration = await connection.db.execute<{ hash: string; created_at: string }>(
      sql`select hash, created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    )
    // Checked, never applied. This database can hold months of collected posts
    // that no run will gather again, so an app meeting a schema it does not
    // recognise says so and stays out rather than altering it — which also
    // means regenerating a shipped migration invalidates every database
    // already carrying it.
    const latest = migration.rows[0]
    if (latest === undefined) throw new CollectionContextError('COLLECTION_SCHEMA_MISSING')
    if (latest.hash !== expected.hash || Number(latest.created_at) !== expected.createdAt) {
      throw new CollectionContextError('COLLECTION_SCHEMA_MISMATCH')
    }
    const repository = createCollectionRepository(connection.db)
    // A crash between startRun and finishRun leaves a run in `running`, and the
    // per-feed single-running-run constraint would then reject every new run.
    // Only this app writes runs, so app start is a safe reconciliation point.
    await repository.reconcileOrphanedRuns(new Date())
    return {
      kind: 'ready',
      repository,
      status: createCollectionStatusQuery(connection.db),
      close: connection.close,
    }
  } catch (error) {
    await connection?.close()
    const code = classifyCollectionContextError(error)
    return {
      kind: 'unavailable', code, close: noOpClose,
      retry: () => openOptionalCollectionContext(environment, migrationsFolder),
    }
  }
}
