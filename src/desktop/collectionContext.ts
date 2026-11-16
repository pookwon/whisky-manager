import { readMigrationFiles } from 'drizzle-orm/migrator'
import { createBoardSearchCoverageQuery, type BoardSearchCoverageQuery } from './collection-db/boardSearchCoverageQuery.js'
import { createBoardSearchLastRunQuery, type BoardSearchLastRunQuery } from './collection-db/boardSearchLastRunQuery.js'
import { createBoardSearchRepository, type BoardSearchRepository } from './collection-db/boardSearchRepository.js'
import { createArticleProbeRepository, type ArticleProbeRepository } from './collection-db/articleProbeRepository.js'
import { createAttendanceRepository, type AttendanceRepository } from './collection-db/attendanceRepository.js'
import { createAttendanceStatusQuery, type AttendanceStatusQuery } from './collection-db/attendanceStatusQuery.js'
import { openCollectionDatabase, type CollectionDatabaseConnection } from './collection-db/client.js'
import { createMemberRepository, type MemberRepository } from './collection-db/memberRepository.js'
import { decideCollectionSchemaState, type CollectionMigrationStamp, type CollectionSchemaState } from './collection-db/migrationState.js'
import {
  applyPendingCollectionMigrations,
  describeMigrationFailure,
  readCollectionDatabaseFacts,
} from './collection-db/pendingMigrations.js'
import { createMemberCollectionStatusQuery, type MemberCollectionStatusQuery } from './collection-db/memberStatusQuery.js'
import { createMemberResyncRepository, type MemberResyncRepository } from './collection-db/memberResyncRepository.js'
import { createCollectionRepository, type CollectionRepository } from './collection-db/repository.js'
import { createCollectionStatusQuery, type CollectionStatusQuery } from './collection-db/statusQuery.js'

export type CollectionUnavailableCode =
  | 'COLLECTION_CONNECTION_FAILED'
  | 'COLLECTION_AUTHENTICATION_FAILED'
  | 'COLLECTION_SCHEMA_MISSING'
  | 'COLLECTION_SCHEMA_MISMATCH'
  | 'COLLECTION_MIGRATION_FILES_MISSING'
  | 'COLLECTION_MIGRATION_FAILED'

export type OptionalCollectionContext =
  | { readonly kind: 'disabled'; close(): Promise<void> }
  | {
      readonly kind: 'ready'
      readonly repository: CollectionRepository
      /** Reading for the screens, kept apart from the repository that writes pages. */
      readonly status: CollectionStatusQuery
      readonly memberRepository: MemberRepository
      readonly memberStatus: MemberCollectionStatusQuery
      /** The periodic re-walk, on its own cursor. */
      readonly memberResyncRepository: MemberResyncRepository
      /** The search backfill past a board's list horizon. */
      readonly boardSearchRepository: BoardSearchRepository
      /** Residual estimate from article-id holes in the search window. */
      readonly boardSearchCoverage: BoardSearchCoverageQuery
      /** How each search query's newest run ended, since search runs stay off the recent log. */
      readonly boardSearchLastRuns: BoardSearchLastRunQuery
      /** The gap's ids, read one by one once the search backfill is done. */
      readonly articleProbeRepository: ArticleProbeRepository
      /** The attendance rounds and their awards. */
      readonly attendanceRepository: AttendanceRepository
      /** Reading of the attendance collection for the screen. */
      readonly attendanceStatus: AttendanceStatusQuery
      close(): Promise<void>
    }
  | {
      readonly kind: 'unavailable'
      readonly code: CollectionUnavailableCode
      retry(): Promise<OptionalCollectionContext>
      close(): Promise<void>
    }

/**
 * Where the connection string comes from, asked again on every retry so an
 * operator who has just written one down does not have to restart to be heard.
 * The context is deliberately not the thing that knows: an installed build
 * reads a file, a development run reads the environment.
 */
export type CollectionDatabaseUrlSource = () => string | null

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

interface PackagedMigrations {
  readonly folder: string
  readonly journal: readonly CollectionMigrationStamp[]
}

function packagedMigrations(migrationsFolder: string | undefined): PackagedMigrations {
  if (migrationsFolder === undefined) {
    throw new CollectionContextError('COLLECTION_MIGRATION_FILES_MISSING')
  }
  try {
    const journal = readMigrationFiles({ migrationsFolder })
      .map((migration) => ({ hash: migration.hash, createdAt: migration.folderMillis }))
    if (journal.length === 0) throw new Error('empty migration journal')
    return { folder: migrationsFolder, journal }
  } catch {
    throw new CollectionContextError('COLLECTION_MIGRATION_FILES_MISSING')
  }
}

async function readSchemaState(
  connection: CollectionDatabaseConnection,
  packaged: PackagedMigrations,
): Promise<CollectionSchemaState> {
  return decideCollectionSchemaState(packaged.journal, await readCollectionDatabaseFacts(connection.db))
}

async function bringSchemaUpToDate(databaseUrl: string, packaged: PackagedMigrations): Promise<void> {
  try {
    await applyPendingCollectionMigrations({
      databaseUrl,
      migrationsFolder: packaged.folder,
      journal: packaged.journal,
    })
  } catch (error) {
    console.error('[collection] migration failed:', describeMigrationFailure(error))
    throw new CollectionContextError('COLLECTION_MIGRATION_FAILED')
  }
}

/**
 * Collection storage is optional while the existing app remains SQLite-only.
 *
 * The schema is brought forward only along the packaged journal. This database
 * can hold months of collected posts that no run will gather again, so an app
 * meeting a schema it does not recognise — a newer app's migration, or a
 * shipped migration that was regenerated — says so and stays out rather than
 * altering it. A database merely behind this build is another matter: the
 * remaining migrations are exactly the ones this build was tested against, and
 * an installed Windows machine has no pnpm or source checkout to run
 * `pnpm db:collection:migrate` from, so the app applies them itself.
 *
 * An empty database — no migration history and no tables — gets the whole
 * journal, so a fresh `createdb` on a new machine needs nothing else. One that
 * holds tables but no history is refused as missing its schema: it is either a
 * restore that left the history out or another application's database, and
 * building collection tables into either would only make the next restore
 * collide with them.
 */
export async function openOptionalCollectionContext(
  databaseUrlSource: CollectionDatabaseUrlSource,
  migrationsFolder?: string,
): Promise<OptionalCollectionContext> {
  const databaseUrl = databaseUrlSource()
  if (databaseUrl === null) return { kind: 'disabled', close: noOpClose }

  let packaged: PackagedMigrations
  try {
    packaged = packagedMigrations(migrationsFolder)
  } catch (error) {
    const code = classifyCollectionContextError(error)
    return {
      kind: 'unavailable', code, close: noOpClose,
      retry: () => openOptionalCollectionContext(databaseUrlSource, migrationsFolder),
    }
  }

  let connection: CollectionDatabaseConnection | null = null
  try {
    connection = openCollectionDatabase({ databaseUrl })
    let state = await readSchemaState(connection, packaged)
    if (state === 'behind' || state === 'empty') {
      await bringSchemaUpToDate(databaseUrl, packaged)
      // Read again rather than trusting the apply: another instance holding
      // the lock may have been a newer app that moved the schema past ours.
      state = await readSchemaState(connection, packaged)
    }
    if (state === 'occupied') throw new CollectionContextError('COLLECTION_SCHEMA_MISSING')
    if (state !== 'current') throw new CollectionContextError('COLLECTION_SCHEMA_MISMATCH')
    const repository = createCollectionRepository(connection.db)
    // A crash between startRun and finishRun leaves a run in `running`, and the
    // per-feed single-running-run constraint would then reject every new run.
    // Only this app writes runs, so app start is a safe reconciliation point.
    await repository.reconcileOrphanedRuns(new Date())
    const memberRepository = createMemberRepository(connection.db)
    await memberRepository.reconcileOrphanedRuns(new Date())
    return {
      kind: 'ready',
      repository,
      status: createCollectionStatusQuery(connection.db),
      memberRepository,
      memberStatus: createMemberCollectionStatusQuery(connection.db),
      memberResyncRepository: createMemberResyncRepository(connection.db, memberRepository),
      boardSearchRepository: createBoardSearchRepository(connection.db, repository),
      boardSearchCoverage: createBoardSearchCoverageQuery(connection.db),
      boardSearchLastRuns: createBoardSearchLastRunQuery(connection.db),
      articleProbeRepository: createArticleProbeRepository(connection.db, repository),
      attendanceRepository: createAttendanceRepository(connection.db),
      attendanceStatus: createAttendanceStatusQuery(connection.db),
      close: connection.close,
    }
  } catch (error) {
    await connection?.close()
    const code = classifyCollectionContextError(error)
    return {
      kind: 'unavailable', code, close: noOpClose,
      retry: () => openOptionalCollectionContext(databaseUrlSource, migrationsFolder),
    }
  }
}
