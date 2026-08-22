import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export type AppDatabase = BetterSQLite3Database<typeof schema>

export interface OpenDatabaseOptions {
  readonly migrationsFolder?: string
}

export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): AppDatabase {
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  if (options.migrationsFolder !== undefined) {
    migrate(db, { migrationsFolder: options.migrationsFolder })
  }
  return db
}
