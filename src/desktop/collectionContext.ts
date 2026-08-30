import { sql } from 'drizzle-orm'
import { collectionDatabaseUrl, openCollectionDatabase, type CollectionDatabaseConnection } from './collection-db/client.js'
import { createCollectionRepository, type CollectionRepository } from './collection-db/repository.js'

export type OptionalCollectionContext =
  | { readonly kind: 'disabled'; close(): Promise<void> }
  | { readonly kind: 'ready'; readonly repository: CollectionRepository; close(): Promise<void> }
  | { readonly kind: 'schema_unavailable'; readonly code: 'COLLECTION_SCHEMA_UNAVAILABLE'; close(): Promise<void> }

const noOpClose = async (): Promise<void> => undefined

/**
 * Collection storage is optional while the existing app remains SQLite-only.
 * This checks an already-applied migration journal and never invokes migrate.
 */
export async function openOptionalCollectionContext(environment: NodeJS.ProcessEnv = process.env): Promise<OptionalCollectionContext> {
  const databaseUrl = collectionDatabaseUrl(environment)
  if (databaseUrl === null) return { kind: 'disabled', close: noOpClose }

  let connection: CollectionDatabaseConnection | null = null
  try {
    connection = openCollectionDatabase({ databaseUrl })
    const migration = await connection.db.execute(sql`select 1 from drizzle.__drizzle_migrations limit 1`)
    if (migration.rows.length === 0) throw new Error('collection migration journal is empty')
    const repository = createCollectionRepository(connection.db)
    // A crash between startRun and finishRun leaves a run in `running`, and the
    // per-feed single-running-run constraint would then reject every new run.
    // Only this app writes runs, so app start is a safe reconciliation point.
    await repository.reconcileOrphanedRuns(new Date())
    return { kind: 'ready', repository, close: connection.close }
  } catch {
    await connection?.close()
    return { kind: 'schema_unavailable', code: 'COLLECTION_SCHEMA_UNAVAILABLE', close: noOpClose }
  }
}
