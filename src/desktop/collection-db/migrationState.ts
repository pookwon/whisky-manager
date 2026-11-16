/** One migration as drizzle records it: the SQL file's hash and the journal's timestamp. */
export interface CollectionMigrationStamp {
  readonly hash: string
  readonly createdAt: number
}

/** What the database records about itself, read before deciding anything. */
export interface CollectionDatabaseFacts {
  /** The newest migration in drizzle's history, or null when there is none. */
  readonly applied: CollectionMigrationStamp | null
  /** Whether the `public` schema already holds any table. */
  readonly hasPublicTables: boolean
}

/**
 * Where the database stands against the migrations this build carries.
 *
 * - `current`: it carries the packaged latest migration.
 * - `behind`: its latest migration is an older entry of the packaged journal,
 *   so the remaining entries are exactly what this build would add.
 * - `empty`: it has no migration history and no tables — a fresh `createdb`.
 * - `occupied`: it has no migration history but already holds tables — a
 *   restore that left the history out, or another application's database.
 *   Neither is this build's to build on.
 * - `unknown`: its latest migration is not in the packaged journal — a newer
 *   app wrote it, or a migration was regenerated. Nothing here may touch it.
 */
export type CollectionSchemaState = 'current' | 'behind' | 'empty' | 'occupied' | 'unknown'

function sameStamp(a: CollectionMigrationStamp, b: CollectionMigrationStamp): boolean {
  return a.hash === b.hash && a.createdAt === b.createdAt
}

export function decideCollectionSchemaState(
  journal: readonly CollectionMigrationStamp[],
  facts: CollectionDatabaseFacts,
): CollectionSchemaState {
  const { applied } = facts
  if (applied === null) return facts.hasPublicTables ? 'occupied' : 'empty'
  const index = journal.findIndex((entry) => sameStamp(entry, applied))
  if (index === -1) return 'unknown'
  return index === journal.length - 1 ? 'current' : 'behind'
}
