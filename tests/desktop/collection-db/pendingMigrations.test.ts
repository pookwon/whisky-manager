import { describe, expect, it } from 'vitest'
import {
  describeMigrationFailure,
  readAppliedCollectionMigration,
  readCollectionDatabaseFacts,
  type MigrationHistoryReader,
} from '../../../src/desktop/collection-db/pendingMigrations.js'

/** drizzle's shape for a failed query: its own error, the driver's as `cause`. */
function wrapped(code: string): Error {
  return Object.assign(new Error('Failed query: select ... postgresql://user@host'), { cause: { code } })
}

function readerResolving(rows: { hash: string; created_at: string }[]): MigrationHistoryReader {
  return { execute: (() => Promise.resolve({ rows })) as unknown as MigrationHistoryReader['execute'] }
}

function readerRejecting(error: unknown): MigrationHistoryReader {
  return { execute: (() => Promise.reject(error)) as unknown as MigrationHistoryReader['execute'] }
}

describe('applied collection migration', () => {
  it('reads the newest recorded migration as a stamp', async () => {
    await expect(readAppliedCollectionMigration(readerResolving([{ hash: 'h1', created_at: '2000' }])))
      .resolves.toEqual({ hash: 'h1', createdAt: 2_000 })
  })

  it('is null for an empty history table', async () => {
    await expect(readAppliedCollectionMigration(readerResolving([]))).resolves.toBeNull()
  })

  it('is null when the history table or its schema does not exist yet', async () => {
    await expect(readAppliedCollectionMigration(readerRejecting(wrapped('42P01')))).resolves.toBeNull()
    await expect(readAppliedCollectionMigration(readerRejecting(wrapped('3F000')))).resolves.toBeNull()
  })

  it('passes any other failure on', async () => {
    const refused = wrapped('28P01')
    await expect(readAppliedCollectionMigration(readerRejecting(refused))).rejects.toBe(refused)
  })
})

describe('collection database facts', () => {
  it('pairs the applied migration with whether public already holds tables', async () => {
    const reader: MigrationHistoryReader = {
      execute: ((query: unknown) => {
        const text = JSON.stringify(query)
        return Promise.resolve({ rows: text.includes('pg_tables') ? [{ present: true }] : [] })
      }) as unknown as MigrationHistoryReader['execute'],
    }
    await expect(readCollectionDatabaseFacts(reader)).resolves.toEqual({ applied: null, hasPublicTables: true })
  })
})

describe('migration failure description', () => {
  it('names the SQLSTATE, found through drizzle\'s wrapper, and never the message', () => {
    expect(describeMigrationFailure(wrapped('42P07'))).toBe('42P07')
    expect(describeMigrationFailure({ code: 'ECONNREFUSED' })).toBe('ECONNREFUSED')
  })

  it('falls back to the error class', () => {
    expect(describeMigrationFailure(new TypeError('postgresql://user@host'))).toBe('TypeError')
    expect(describeMigrationFailure('nope')).toBe('unknown')
  })
})
