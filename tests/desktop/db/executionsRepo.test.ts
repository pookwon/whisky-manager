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
    authorId: `member-${postId}`,
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

/** 2026-08-24 00:00 KST, and the day that follows it. */
const DAY = 86_400_000
const TODAY = Date.UTC(2026, 7, 23, 15, 0)
const TOMORROW = TODAY + DAY
const EARLIER_DAY = TODAY - DAY

describe('countByStatusForDay', () => {
  it('counts by the day the post belongs to, not the day it was resolved', async () => {
    const today = await claim('1001', TODAY + 3_600_000)
    const earlier = await claim('1002', EARLIER_DAY + 3_600_000)
    const failedToday = await claim('1003', TODAY + 7_200_000)

    // All three resolved now: filling in an earlier day happens today too.
    repo.applyPatch(today, { status: 'SUCCESS', resolvedAt: TODAY + 40_000_000 })
    repo.applyPatch(earlier, { status: 'SUCCESS', resolvedAt: TODAY + 40_000_000 })
    repo.applyPatch(failedToday, { status: 'FAILED', resolvedAt: TODAY + 40_000_000 })

    expect(repo.countByStatusForDay(AUTOMATION, 'SUCCESS', TODAY, TOMORROW)).toBe(1)
    expect(repo.countByStatusForDay(AUTOMATION, 'FAILED', TODAY, TOMORROW)).toBe(1)
    expect(repo.countByStatusForDay(AUTOMATION, 'SUCCESS', EARLIER_DAY, TODAY)).toBe(1)
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

describe('listQueued', () => {
  it('returns rows ready to execute with the text already decided', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 1_000)

    repo.applyPatch(a, { status: 'QUEUED', renderedText: 'hello', templateId: 'tpl-1', attempts: 1 })
    repo.applyPatch(b, { status: 'AWAITING_APPROVAL' })

    const queued = repo.listQueued(AUTOMATION)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      id: a,
      cafeId: '10000000',
      boardId: '5',
      targetPostId: '1001',
      renderedText: 'hello',
      templateId: 'tpl-1',
      attempts: 1,
    })
  })

  it('omits queued rows that have no text yet', async () => {
    const a = await claim('1003', 1_000)
    repo.applyPatch(a, { status: 'QUEUED' })
    expect(repo.listQueued(AUTOMATION)).toEqual([])
  })
})

describe('listByStatus', () => {
  it('returns rows in the requested status with their detection time', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 1_000)
    repo.applyPatch(a, { status: 'RETRY_WAIT' })
    repo.applyPatch(b, { status: 'AWAITING_APPROVAL' })

    const retries = repo.listByStatus(AUTOMATION, 'RETRY_WAIT')
    expect(retries).toHaveLength(1)
    expect(retries[0]).toMatchObject({ id: a, targetPostId: '1001', detectedAt: 2_000 })
  })
})

describe('countByStatus', () => {
  it('counts only the requested status', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 1_000)
    const c = await claim('1003', 1_000)

    repo.applyPatch(a, { status: 'AWAITING_APPROVAL' })
    repo.applyPatch(b, { status: 'AWAITING_APPROVAL' })
    repo.applyPatch(c, { status: 'SUCCESS', resolvedAt: 2_000 })

    expect(repo.countByStatus(AUTOMATION, 'AWAITING_APPROVAL')).toBe(2)
    expect(repo.countByStatus(AUTOMATION, 'FAILED')).toBe(0)
  })
})

describe('countExecutedForDay', () => {
  it('counts every attempt on that day\'s posts, not only the successes', async () => {
    const a = await claim('1001', TODAY + 3_600_000)
    const b = await claim('1002', TODAY + 3_600_000)

    repo.applyPatch(a, { status: 'SUCCESS', executedAt: TODAY + 40_000_000, resolvedAt: TODAY + 40_000_000 })
    repo.applyPatch(b, { status: 'RETRY_WAIT', executedAt: TODAY + 40_000_000 })

    expect(repo.countExecutedForDay(AUTOMATION, TODAY, TOMORROW)).toBe(2)
  })

  it('leaves an earlier day being filled in out of today\'s count', async () => {
    // The comment goes out today either way; what separates them is which
    // day's greetings the work served. Today's allowance is for today's posts.
    const earlier = await claim('2001', EARLIER_DAY + 3_600_000)
    repo.applyPatch(earlier, { status: 'SUCCESS', executedAt: TODAY + 40_000_000, resolvedAt: TODAY + 40_000_000 })

    expect(repo.countExecutedForDay(AUTOMATION, TODAY, TOMORROW)).toBe(0)
    expect(repo.countExecutedForDay(AUTOMATION, EARLIER_DAY, TODAY)).toBe(1)
  })

  it('ignores a post nothing was sent for', async () => {
    await claim('3001', TODAY + 3_600_000)

    expect(repo.countExecutedForDay(AUTOMATION, TODAY, TOMORROW)).toBe(0)
  })
})

describe('listAwaitingDetail', () => {
  it('returns what an operator needs to judge the request', async () => {
    const id = await claim('1001', 1_000)
    repo.applyPatch(id, {
      status: 'AWAITING_APPROVAL',
      renderedText: 'nick님 환영합니다',
      riskFlags: ['COMMENT_CHECK_FAILED'],
    })

    const rows = repo.listAwaitingDetail(AUTOMATION)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id,
      targetPostId: '1001',
      targetAuthor: 'nick',
      renderedText: 'nick님 환영합니다',
      riskFlags: ['COMMENT_CHECK_FAILED'],
      detectedAt: 2_000,
    })
  })

  it('ignores rows in any other status', async () => {
    const id = await claim('1002', 1_000)
    repo.applyPatch(id, { status: 'QUEUED', renderedText: 'x' })
    expect(repo.listAwaitingDetail(AUTOMATION)).toEqual([])
  })
})
