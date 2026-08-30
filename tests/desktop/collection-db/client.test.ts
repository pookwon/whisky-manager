import { describe, expect, it } from 'vitest'
import {
  CollectionDatabaseConfigError,
  collectionDatabaseUrl,
  openCollectionDatabase,
} from '../../../src/desktop/collection-db/client.js'

describe('collection database connection configuration', () => {
  it('reads DATABASE_URL only from the main-process environment object', () => {
    expect(collectionDatabaseUrl({ DATABASE_URL: ' postgres://collection ' })).toBe('postgres://collection')
    expect(collectionDatabaseUrl({ DATABASE_URL: '  ' })).toBeNull()
    expect(collectionDatabaseUrl({})).toBeNull()
  })

  it('does not construct a pool for a missing database URL', () => {
    expect(() => openCollectionDatabase({ databaseUrl: '  ' })).toThrow(CollectionDatabaseConfigError)
  })
})
