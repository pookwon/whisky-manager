import { describe, expect, it } from 'vitest'
import { decideCollectionSchemaState } from '../../../src/desktop/collection-db/migrationState.js'

const journal = [
  { hash: 'h0', createdAt: 1_000 },
  { hash: 'h1', createdAt: 2_000 },
  { hash: 'h2', createdAt: 3_000 },
]

const at = (applied: { hash: string; createdAt: number }) => ({ applied, hasPublicTables: true })

describe('collection schema state', () => {
  it('is current when the database carries the packaged latest migration', () => {
    expect(decideCollectionSchemaState(journal, at({ hash: 'h2', createdAt: 3_000 }))).toBe('current')
  })

  it('is behind when the database carries an older migration from the same journal', () => {
    expect(decideCollectionSchemaState(journal, at({ hash: 'h0', createdAt: 1_000 }))).toBe('behind')
    expect(decideCollectionSchemaState(journal, at({ hash: 'h1', createdAt: 2_000 }))).toBe('behind')
  })

  it('is empty when the database has neither migration history nor tables', () => {
    expect(decideCollectionSchemaState(journal, { applied: null, hasPublicTables: false })).toBe('empty')
  })

  it('is occupied when the database holds tables but no migration history', () => {
    expect(decideCollectionSchemaState(journal, { applied: null, hasPublicTables: true })).toBe('occupied')
  })

  it('is unknown when the latest migration is newer than anything packaged', () => {
    expect(decideCollectionSchemaState(journal, at({ hash: 'h3', createdAt: 4_000 }))).toBe('unknown')
  })

  it('is unknown when a known timestamp carries a different hash', () => {
    expect(decideCollectionSchemaState(journal, at({ hash: 'regenerated', createdAt: 2_000 }))).toBe('unknown')
  })

  it('is unknown when a known hash carries a different timestamp', () => {
    expect(decideCollectionSchemaState(journal, at({ hash: 'h1', createdAt: 2_500 }))).toBe('unknown')
  })

  it('treats an empty packaged journal as knowing nothing', () => {
    expect(decideCollectionSchemaState([], at({ hash: 'h0', createdAt: 1_000 }))).toBe('unknown')
  })
})
