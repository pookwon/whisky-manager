import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ensureCollectionDatabaseConfig,
  readCollectionDatabaseConfig,
  resolveCollectionDatabaseUrl,
} from '../../src/desktop/collectionDatabaseConfig.js'

function tempFile(name: string, contents?: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'collection-config-')), name)
  if (contents !== undefined) writeFileSync(path, contents, 'utf8')
  return path
}

describe('collection database configuration file', () => {
  it('reads the URL an installed build was given', () => {
    const path = tempFile('collection-db.json', '{"databaseUrl":"  postgresql://127.0.0.1/collection  "}')
    expect(readCollectionDatabaseConfig(path)).toBe('postgresql://127.0.0.1/collection')
  })

  it('treats an absent, empty or malformed file as no configuration', () => {
    expect(readCollectionDatabaseConfig(tempFile('missing.json'))).toBeNull()
    expect(readCollectionDatabaseConfig(tempFile('empty.json', '{"databaseUrl":"  "}'))).toBeNull()
    expect(readCollectionDatabaseConfig(tempFile('broken.json', '{'))).toBeNull()
    expect(readCollectionDatabaseConfig(tempFile('array.json', '[]'))).toBeNull()
  })

  it('writes a template only when nothing is there yet', () => {
    const path = tempFile('collection-db.json')
    ensureCollectionDatabaseConfig(path)
    expect(readCollectionDatabaseConfig(path)).toBeNull()

    writeFileSync(path, '{"databaseUrl":"postgresql://127.0.0.1/kept"}', 'utf8')
    ensureCollectionDatabaseConfig(path)
    expect(readFileSync(path, 'utf8')).toContain('kept')
  })

  it('lets the environment override the file, and falls back to it', () => {
    const path = tempFile('collection-db.json', '{"databaseUrl":"postgresql://127.0.0.1/from-file"}')
    expect(resolveCollectionDatabaseUrl({ DATABASE_URL: 'postgresql://127.0.0.1/from-env' }, path)).toBe(
      'postgresql://127.0.0.1/from-env',
    )
    expect(resolveCollectionDatabaseUrl({}, path)).toBe('postgresql://127.0.0.1/from-file')
    expect(resolveCollectionDatabaseUrl({})).toBeNull()
  })
})
