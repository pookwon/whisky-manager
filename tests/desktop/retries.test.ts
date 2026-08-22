import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { promoteRetries } from '../../src/desktop/retries.js'
import { PROFILES } from '../../src/shared/profiles.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const AUTOMATION = 'welcome-comment'
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)
const limits = PROFILES.production

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let counter = 0

async function seed(postId: string, postedAt: number, status: 'RETRY_WAIT' | 'QUEUED'): Promise<string> {
  const store = createSqliteDedupeStore(db, () => `id-${++counter}`)
  const id = await store.claim({
    automationId: AUTOMATION,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: null,
    authorNickname: 'nick',
    authorId: 'm1',
    postedAt,
    detectedAt: postedAt,
  })
  if (id === null) throw new Error('seed claim failed')
  repo.applyPatch(id, { status, renderedText: 'hello', attempts: 1 })
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-retry-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('promoteRetries', () => {
  it('promotes a fresh retry back to the queue', async () => {
    const id = await seed('1001', NOW - 2 * HOUR, 'RETRY_WAIT')

    expect(promoteRetries(repo, AUTOMATION, limits, NOW)).toEqual({ promoted: 1, expired: 0 })
    expect(repo.getById(id)?.status).toBe('QUEUED')
  })

  it('expires a retry whose post has grown stale instead of promoting it', async () => {
    const id = await seed('1002', NOW - 30 * HOUR, 'RETRY_WAIT')

    expect(promoteRetries(repo, AUTOMATION, limits, NOW)).toEqual({ promoted: 0, expired: 1 })
    expect(repo.getById(id)?.status).toBe('EXPIRED')
  })

  it('leaves rows that are already queued alone', async () => {
    const id = await seed('1003', NOW - HOUR, 'QUEUED')

    expect(promoteRetries(repo, AUTOMATION, limits, NOW)).toEqual({ promoted: 0, expired: 0 })
    expect(repo.getById(id)?.status).toBe('QUEUED')
  })
})
