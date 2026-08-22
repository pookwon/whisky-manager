import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../../src/desktop/db/executionsRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const AUTOMATION = 'welcome-comment'

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let counter = 0

async function claim(postId: string, postedAt: number): Promise<string> {
  const store = createSqliteDedupeStore(db, () => `id-${++counter}`)
  const id = await store.claim({
    automationId: AUTOMATION,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: null,
    authorNickname: 'nick',
    authorId: 'member',
    postedAt,
    detectedAt: postedAt + 1000,
  })
  if (id === null) throw new Error('claim failed in fixture')
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-repo-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('applyPatch', () => {
  it('writes status, strategy, timestamps and risk flags', async () => {
    const id = await claim('1001', 1_000)
    repo.applyPatch(id, {
      status: 'SUCCESS',
      strategy: 'FETCH',
      riskFlags: [],
      executedAt: 1_900,
      resolvedAt: 2_000,
    })

    const found = repo.getById(id)
    expect(found?.status).toBe('SUCCESS')
    expect(found?.strategy).toBe('FETCH')
    expect(found?.executedAt).toBe(1_900)
    expect(found?.resolvedAt).toBe(2_000)
  })

  it('serialises risk flags as json', async () => {
    const id = await claim('1002', 1_000)
    repo.applyPatch(id, { status: 'AWAITING_APPROVAL', riskFlags: ['STRUCTURE_CHANGED', 'COMMENT_CHECK_FAILED'] })

    expect(repo.getById(id)?.riskFlags).toEqual(['STRUCTURE_CHANGED', 'COMMENT_CHECK_FAILED'])
  })
})

describe('countSuccessSince', () => {
  it('counts only successes inside the window', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 1_000)
    const c = await claim('1003', 1_000)

    repo.applyPatch(a, { status: 'SUCCESS', resolvedAt: 5_000 })
    repo.applyPatch(b, { status: 'SUCCESS', resolvedAt: 500 })
    repo.applyPatch(c, { status: 'FAILED', resolvedAt: 6_000 })

    expect(repo.countSuccessSince(AUTOMATION, 1_000)).toBe(1)
  })
})

describe('listUnresolved', () => {
  it('returns only rows that still owe work', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 2_000)
    const c = await claim('1003', 3_000)

    repo.applyPatch(a, { status: 'QUEUED' })
    repo.applyPatch(b, { status: 'RETRY_WAIT' })
    repo.applyPatch(c, { status: 'SUCCESS', resolvedAt: 9_000 })

    const unresolved = repo.listUnresolved(AUTOMATION)
    expect(unresolved.map((r) => r.targetPostId).sort()).toEqual(['1001', '1002'])
  })
})
