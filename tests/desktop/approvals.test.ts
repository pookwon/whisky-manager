import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approve, reject, sweepApprovals } from '../../src/desktop/approvals.js'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
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

async function seedAwaiting(postId: string, detectedAt: number): Promise<string> {
  const store = createSqliteDedupeStore(db, () => `id-${++counter}`)
  const id = await store.claim({
    automationId: AUTOMATION,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: null,
    authorNickname: 'nick',
    authorId: `m${postId}`,
    postedAt: detectedAt,
    detectedAt,
  })
  if (id === null) throw new Error('seed claim failed')
  repo.applyPatch(id, { status: 'AWAITING_APPROVAL', renderedText: 'hello' })
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-approval-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('approve', () => {
  it('moves an awaiting row into the queue', async () => {
    const id = await seedAwaiting('1001', NOW - HOUR)
    approve(repo, id, limits)
    expect(repo.getById(id)?.status).toBe('QUEUED')
  })

  it('refuses to approve a row that is not awaiting approval', async () => {
    const id = await seedAwaiting('1002', NOW - HOUR)
    repo.applyPatch(id, { status: 'SUCCESS', resolvedAt: NOW })
    expect(() => approve(repo, id, limits)).toThrow()
  })

  it('refuses an unknown execution', () => {
    expect(() => approve(repo, 'nope', limits)).toThrow(/unknown execution/i)
  })

  it('answers a row with no text with a refusal instead of queueing it', async () => {
    const id = await seedAwaiting('1006', NOW - HOUR)
    repo.applyPatch(id, { status: 'AWAITING_APPROVAL', renderedText: null })

    expect(approve(repo, id, limits)).toEqual({ kind: 'refused', reason: 'NO_TEXT' })
    // Still awaiting, which is what lets the sweep retire it. Queued, it would
    // be skipped by the backlog walk, never revived by a claim, and would halt
    // the automation with STALE_BACKLOG once it aged past two days.
    expect(repo.getById(id)?.status).toBe('AWAITING_APPROVAL')
  })

  it('leaves the refused row for the sweep to retire', async () => {
    const id = await seedAwaiting('1007', NOW - 50 * HOUR)
    repo.applyPatch(id, { status: 'AWAITING_APPROVAL', renderedText: null })
    approve(repo, id, limits)

    expect(sweepApprovals(repo, AUTOMATION, limits, NOW)).toEqual({ expired: 1 })
    expect(repo.getById(id)?.status).toBe('EXPIRED')
  })

  it('says so plainly when the row does have text', async () => {
    const id = await seedAwaiting('1008', NOW - HOUR)
    expect(approve(repo, id, limits)).toEqual({ kind: 'approved' })
  })
})

describe('reject', () => {
  it('terminates the row as skipped with the operator reason', async () => {
    const id = await seedAwaiting('1003', NOW - HOUR)
    reject(repo, id, NOW)

    const row = repo.getById(id)
    expect(row?.status).toBe('SKIPPED')
    expect(row?.reason).toBe('REJECTED_BY_OPERATOR')
    expect(row?.resolvedAt).toBe(NOW)
  })
})

describe('sweepApprovals', () => {
  it('expires rows that waited past the ttl', async () => {
    const stale = await seedAwaiting('1004', NOW - 50 * HOUR)
    const fresh = await seedAwaiting('1005', NOW - 2 * HOUR)

    expect(sweepApprovals(repo, AUTOMATION, limits, NOW)).toEqual({ expired: 1 })
    expect(repo.getById(stale)?.status).toBe('EXPIRED')
    expect(repo.getById(fresh)?.status).toBe('AWAITING_APPROVAL')
  })

  it('is a no-op when the queue is empty', () => {
    expect(sweepApprovals(repo, AUTOMATION, limits, NOW)).toEqual({ expired: 0 })
  })
})
