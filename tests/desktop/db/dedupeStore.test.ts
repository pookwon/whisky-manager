import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createSqliteDedupeStore, type ClaimInput } from '../../../src/desktop/db/dedupeStore.js'
import { executions } from '../../../src/desktop/db/schema.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

const input: ClaimInput = {
  automationId: 'welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  postId: '1001',
  title: '가입인사',
  authorNickname: '신입회원',
  authorId: 'member-1',
  postedAt: 1_700_000_000_000,
  detectedAt: 1_700_000_100_000,
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-dedupe-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function store() {
  let counter = 0
  return createSqliteDedupeStore(db, () => `id-${++counter}`)
}

describe('createSqliteDedupeStore', () => {
  it('claims an unseen post and returns its execution id', async () => {
    await expect(store().claim(input)).resolves.toBe('id-1')

    const rows = db.select().from(executions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('AWAITING_APPROVAL')
    expect(rows[0]?.attempts).toBe(0)
  })

  it('returns null for a post already claimed', async () => {
    const s = store()
    await s.claim(input)
    await expect(s.claim(input)).resolves.toBeNull()
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('lets exactly one of many concurrent claims win', async () => {
    const s = store()
    const results = await Promise.all(Array.from({ length: 10 }, () => s.claim(input)))
    expect(results.filter((r) => r !== null)).toHaveLength(1)
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('treats the same post id in a different cafe as a separate claim', async () => {
    const s = store()
    await s.claim(input)
    await expect(s.claim({ ...input, cafeId: '99999999' })).resolves.not.toBeNull()
    expect(db.select().from(executions).all()).toHaveLength(2)
  })

  it('claims only the first post from an author, whichever post it is', async () => {
    const s = store()
    const first = await s.claim({ ...input, postId: '1001', authorId: 'member-1' })
    const second = await s.claim({ ...input, postId: '1002', authorId: 'member-1' })
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('still claims a different author on the same board', async () => {
    const s = store()
    await s.claim({ ...input, postId: '1001', authorId: 'member-1' })
    await expect(s.claim({ ...input, postId: '1002', authorId: 'member-2' })).resolves.not.toBeNull()
  })

  it('claims posts with no author id independently', async () => {
    const s = store()
    await s.claim({ ...input, postId: '1001', authorId: null })
    await expect(s.claim({ ...input, postId: '1002', authorId: null })).resolves.not.toBeNull()
  })

  it('keeps authors of different cafes apart', async () => {
    const s = store()
    await s.claim({ ...input, postId: '1001', authorId: 'member-1' })
    await expect(
      s.claim({ ...input, cafeId: '99999', postId: '1001', authorId: 'member-1' }),
    ).resolves.not.toBeNull()
  })
})
