import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { executions } from '../../../src/desktop/db/schema.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

const row = {
  id: 'e1',
  automationId: 'welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  targetPostId: '1001',
  targetTitle: null,
  targetAuthor: null,
  targetAuthorId: null,
  targetPostedAt: 1,
  actorAccount: null,
  status: 'QUEUED' as const,
  strategy: null,
  riskFlags: '[]',
  reason: null,
  templateId: null,
  renderedText: null,
  attempts: 0,
  detectedAt: 1,
  executedAt: null,
  resolvedAt: null,
  deletedAt: null,
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-db-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('creates the executions table via migrations', () => {
    expect(db.select().from(executions).all()).toEqual([])
  })

  it('enforces one row per cafe, automation and post', () => {
    db.insert(executions).values(row).run()
    expect(() => db.insert(executions).values({ ...row, id: 'e2' }).run()).toThrow(/UNIQUE/i)
  })

  it('treats the same post id in a different cafe as a separate row', () => {
    db.insert(executions).values(row).run()
    db.insert(executions).values({ ...row, id: 'e3', cafeId: '99999999' }).run()
    expect(db.select().from(executions).all()).toHaveLength(2)
  })
})
