import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
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

  it('does not reject different posts from the same author', async () => {
    const s = store()
    const first = await s.claim({ ...input, postId: '1001', authorId: 'member-1' })
    const second = await s.claim({ ...input, postId: '1002', authorId: 'member-1' })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(second)
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

  describe('reopen revivable rows', () => {
    it('revives a SKIPPED row with the same id and reset state', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      // Manually set to SKIPPED
      db.update(executions)
        .set({ status: 'SKIPPED', reason: 'ALREADY_COMMENTED', resolvedAt: 12345 })
        .where(eq(executions.id, firstId!))
        .run()

      // Claiming the same post again
      const revivedId = await s.claim(input)
      expect(revivedId).toBe(firstId)

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('AWAITING_APPROVAL')
      expect(row?.reason).toBeNull()
      expect(row?.riskFlags).toBe('[]')
      expect(row?.resolvedAt).toBeNull()
      expect(row?.attempts).toBe(0)
    })

    it('revives an EXPIRED row with the same id and reset state', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      db.update(executions)
        .set({ status: 'EXPIRED', reason: 'APPROVAL_EXPIRED', resolvedAt: 12345 })
        .where(eq(executions.id, firstId!))
        .run()

      const revivedId = await s.claim(input)
      expect(revivedId).toBe(firstId)

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('AWAITING_APPROVAL')
      expect(row?.reason).toBeNull()
      expect(row?.riskFlags).toBe('[]')
      expect(row?.resolvedAt).toBeNull()
      expect(row?.attempts).toBe(0)
    })

    it('revives a CANCELLED row with the same id and reset state', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      db.update(executions)
        .set({ status: 'CANCELLED', reason: 'KILLED', resolvedAt: 12345 })
        .where(eq(executions.id, firstId!))
        .run()

      const revivedId = await s.claim(input)
      expect(revivedId).toBe(firstId)

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('AWAITING_APPROVAL')
      expect(row?.reason).toBeNull()
      expect(row?.riskFlags).toBe('[]')
      expect(row?.resolvedAt).toBeNull()
      expect(row?.attempts).toBe(0)
    })

    it('does not revive a SUCCESS row', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      db.update(executions)
        .set({ status: 'SUCCESS', executedAt: 12345, resolvedAt: 12346 })
        .where(eq(executions.id, firstId!))
        .run()

      const result = await s.claim(input)
      expect(result).toBeNull()

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('SUCCESS')
      expect(row?.executedAt).toBe(12345)
      expect(row?.resolvedAt).toBe(12346)
    })

    it('does not revive a FAILED row', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      db.update(executions)
        .set({ status: 'FAILED', reason: 'NO_REPLY', attempts: 3, resolvedAt: 12345 })
        .where(eq(executions.id, firstId!))
        .run()

      const result = await s.claim(input)
      expect(result).toBeNull()

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('FAILED')
      expect(row?.attempts).toBe(3)
      expect(row?.resolvedAt).toBe(12345)
    })

    it('does not revive a QUEUED row', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      db.update(executions).set({ status: 'QUEUED' }).where(eq(executions.id, firstId!)).run()

      const result = await s.claim(input)
      expect(result).toBeNull()

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('QUEUED')
    })

    it('does not revive a RETRY_WAIT row', async () => {
      const s = store()
      const firstId = await s.claim(input)
      expect(firstId).not.toBeNull()

      db.update(executions)
        .set({ status: 'RETRY_WAIT', attempts: 1 })
        .where(eq(executions.id, firstId!))
        .run()

      const result = await s.claim(input)
      expect(result).toBeNull()

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('RETRY_WAIT')
      expect(row?.attempts).toBe(1)
    })

    it('does not revive an AWAITING_APPROVAL row', async () => {
      const s = store()
      const firstId = await s.claim(input)
      // Already AWAITING_APPROVAL from creation

      const result = await s.claim(input)
      expect(result).toBeNull()

      const row = db.select().from(executions).where(eq(executions.id, firstId!)).get()
      expect(row?.status).toBe('AWAITING_APPROVAL')
    })
  })
})
