import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseCafeArticleListText } from '../../../src/shared/cafeArticleList.js'
import { parseCafeMemberListText } from '../../../src/shared/cafeMemberList.js'
import { openCollectionDatabase, type CollectionDatabaseConnection } from '../../../src/desktop/collection-db/client.js'
import { createCollectionRepository } from '../../../src/desktop/collection-db/repository.js'
import { createMemberRepository } from '../../../src/desktop/collection-db/memberRepository.js'
import { openOptionalCollectionContext } from '../../../src/desktop/collectionContext.js'
import { createCollectionStatusQuery } from '../../../src/desktop/collection-db/statusQuery.js'
import { members } from '../../../src/desktop/collection-db/memberSchema.js'
import { eq } from 'drizzle-orm'

const testDatabaseUrl = process.env.COLLECTION_TEST_DATABASE_URL?.trim()
const integration = testDatabaseUrl === undefined || testDatabaseUrl === '' ? describe.skip : describe
const migrationsFolder = fileURLToPath(new URL('../../../drizzle-collection', import.meta.url))
const page = parseCafeArticleListText(
  readFileSync(fileURLToPath(new URL('../../fixtures/cafe-article-list-page-1.json', import.meta.url)), 'utf8'),
)
const memberPage = parseCafeMemberListText(
  readFileSync(fileURLToPath(new URL('../../fixtures/cafe-member-list-sample.json', import.meta.url)), 'utf8'),
)

const COLLECTION_TABLES = ['members', 'member_runs', 'member_feed_state', 'posts', 'boards', 'feed_state', 'runs']
const COLLECTION_TYPES = ['collection_feed_kind', 'collection_run_kind', 'collection_run_status', 'member_run_kind']

let pool: Pool
let connection: CollectionDatabaseConnection
let verifiedEmptyTestDatabase = false

function assertDedicatedTestDatabase(url: string): void {
  const database = decodeURIComponent(new URL(url).pathname).replace(/^\//, '')
  if (!/(?:^|_)test(?:ing)?$/.test(database)) {
    throw new Error('COLLECTION_TEST_DATABASE_URL must name a dedicated database ending in _test or _testing')
  }
}

async function countRows(table: string): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*)::text as count from ${table}`)
  return Number(result.rows[0]?.count ?? 0)
}

async function cleanCollectionObjects(): Promise<void> {
  await pool.query(`drop table if exists ${COLLECTION_TABLES.join(', ')} cascade`)
  await pool.query(`drop type if exists ${COLLECTION_TYPES.join(', ')} cascade`)
  await pool.query('drop schema if exists drizzle cascade')
}

integration('collection PostgreSQL integration (opt-in)', () => {
  beforeAll(async () => {
    // This test never accepts the app's normal DATABASE_URL. A separately
    // named, empty database is the authorization boundary for migration DDL.
    assertDedicatedTestDatabase(testDatabaseUrl as string)
    pool = new Pool({ connectionString: testDatabaseUrl, max: 2, connectionTimeoutMillis: 5_000 })
    const existing = await pool.query<{ name: string }>(
      `select tablename as name from pg_tables where schemaname = 'public'
       union all
       select typname as name from pg_type join pg_namespace on pg_namespace.oid = pg_type.typnamespace
       where pg_namespace.nspname = 'public' and typname = any($1::text[])
       union all
       select nspname as name from pg_namespace where nspname = 'drizzle'`,
      [COLLECTION_TYPES],
    )
    if (existing.rows.length > 0) {
      throw new Error('COLLECTION_TEST_DATABASE_URL must point to an empty dedicated test database')
    }
    verifiedEmptyTestDatabase = true

    connection = openCollectionDatabase({ databaseUrl: testDatabaseUrl as string, maxConnections: 2 })
    await migrate(drizzle(pool), { migrationsFolder })
  })

  afterAll(async () => {
    try {
      // Never clean an existing database that failed the empty-database guard.
      if (verifiedEmptyTestDatabase && pool !== undefined) await cleanCollectionObjects()
    } finally {
      await connection?.close()
      await pool?.end()
    }
  })

  it('applies migrations, persists a page atomically, rejects stale CAS, and keeps observations idempotent', async () => {
    const repository = createCollectionRepository(connection.db)
    const feed = { feedKind: 'all_articles' as const, menuId: '0' }
    const now = new Date('2026-08-30T00:00:00.000Z')
    const runId = randomUUID()

    await repository.startRun({
      ...feed,
      id: runId,
      runKind: 'development',
      resumeFromCheckpoint: false,
      targetStartMs: Date.UTC(2026, 7, 27, 15),
      targetEndMs: Date.UTC(2026, 7, 30, 15),
      startedAt: now,
    })

    const first = await repository.persistPage({
      feed,
      runId,
      observedAt: now,
      referencePage: 1,
      expectedState: { stateVersion: 0, anchorPostId: null },
      page,
    })
    expect(first).toMatchObject({ kind: 'stored', insertedPostCount: 50, updatedPostCount: 0 })
    if (first.kind !== 'stored') throw new Error('first page persistence unexpectedly conflicted')
    expect(await countRows('posts')).toBe(50)

    const second = await repository.persistPage({
      feed,
      runId,
      observedAt: new Date(now.getTime() + 1_000),
      referencePage: 1,
      expectedState: { stateVersion: 1, anchorPostId: first.anchorPostId },
      page,
    })
    expect(second).toMatchObject({ kind: 'stored', insertedPostCount: 0, updatedPostCount: 50 })

    const originalTitle = page.items[0]?.title
    const rollbackPage = {
      ...page,
      items: page.items.map((item, index) => (index === 0 ? { ...item, title: '__must_rollback__' } : item)),
    }
    const stale = await repository.persistPage({
      feed,
      runId,
      observedAt: new Date(now.getTime() + 2_000),
      referencePage: 1,
      expectedState: { stateVersion: 0, anchorPostId: null },
      page: rollbackPage,
    })
    expect(stale).toEqual({ kind: 'conflict' })

    expect(await countRows('posts')).toBe(50)
    const title = await pool.query<{ title: string | null }>('select title from posts where post_id = $1', [page.items[0]?.postId])
    expect(title.rows[0]?.title).toBe(originalTitle)
    const run = await pool.query<{ collection_pages: number; observed_post_count: number }>(
      'select collection_pages, observed_post_count from runs where id = $1',
      [runId],
    )
    expect(run.rows[0]).toEqual({ collection_pages: 2, observed_post_count: 100 })

    // The screen's read model, against the rows the writes above just made.
    const status = createCollectionStatusQuery(connection.db)
    const whileRunning = await status.read()
    expect(whileRunning.totals).toMatchObject({
      posts: 50,
      // However many boards the page's rows actually name — the count comes
      // from the same rows the writes above stored.
      boards: new Set(page.items.map((item) => item.boardId)).size,
    })
    expect(whileRunning.totals.oldestPostedAtMs).toBe(
      Math.min(...page.items.map((item) => item.postedAt)),
    )
    expect(whileRunning.totals.newestPostedAtMs).toBe(
      Math.max(...page.items.map((item) => item.postedAt)),
    )
    expect(whileRunning.running).toMatchObject({ id: runId, status: 'running', collectionPages: 2 })
    // The cursor reports the anchor post's own posted time, so progress is
    // measured against the target range rather than against a page count.
    expect(whileRunning.running?.cursorPostedAtMs).toBeTypeOf('number')
    expect(whileRunning.recentRuns[0]?.id).toBe(runId)

    await repository.finishRun(runId, 'interrupted', 'TEST_RANGE_RESUME', new Date(now.getTime() + 3_000))

    const afterFinish = await status.read()
    expect(afterFinish.running).toBeNull()
    expect(afterFinish.recentRuns[0]).toMatchObject({
      id: runId,
      status: 'interrupted',
      stopReason: 'TEST_RANGE_RESUME',
    })
    expect(afterFinish.recentRuns[0]?.finishedAtMs).toBeTypeOf('number')
    const stateBeforeResume = await repository.readFeedState(feed)
    const resumedRunId = randomUUID()
    const resumed = await repository.startRun({
      ...feed,
      id: resumedRunId,
      runKind: 'development',
      resumeFromCheckpoint: true,
      targetStartMs: Date.UTC(2026, 7, 27, 15),
      targetEndMs: Date.UTC(2026, 7, 30, 15),
      startedAt: new Date(now.getTime() + 4_000),
    })
    expect(resumed).toMatchObject({
      stateVersion: stateBeforeResume?.stateVersion,
      anchorPostId: stateBeforeResume?.anchorPostId,
      referencePage: stateBeforeResume?.referencePage,
    })
    await repository.finishRun(resumedRunId, 'interrupted', 'TEST_RANGE_CHANGE', new Date(now.getTime() + 5_000))

    const freshSameRangeRunId = randomUUID()
    const freshSameRange = await repository.startRun({
      ...feed,
      id: freshSameRangeRunId,
      runKind: 'development',
      resumeFromCheckpoint: false,
      targetStartMs: Date.UTC(2026, 7, 27, 15),
      targetEndMs: Date.UTC(2026, 7, 30, 15),
      startedAt: new Date(now.getTime() + 6_000),
    })
    expect(freshSameRange).toMatchObject({
      stateVersion: (stateBeforeResume?.stateVersion ?? 0) + 1,
      anchorPostId: null,
      referencePage: null,
      pageIdentity: null,
    })
    await repository.finishRun(freshSameRangeRunId, 'interrupted', 'TEST_CHANGED_RESUME', new Date(now.getTime() + 7_000))

    await expect(
      repository.startRun({
        ...feed,
        id: randomUUID(),
        runKind: 'backfill',
        resumeFromCheckpoint: true,
        targetStartMs: Date.UTC(2026, 6, 1, 15),
        targetEndMs: Date.UTC(2026, 7, 1, 15),
        startedAt: new Date(now.getTime() + 8_000),
      }),
    ).rejects.toThrow('different target range')

    const changedRunId = randomUUID()
    const changed = await repository.startRun({
      ...feed,
      id: changedRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: false,
      targetStartMs: Date.UTC(2026, 6, 1, 15),
      targetEndMs: Date.UTC(2026, 7, 1, 15),
      startedAt: new Date(now.getTime() + 9_000),
    })
    expect(changed).toMatchObject({
      stateVersion: (stateBeforeResume?.stateVersion ?? 0) + 2,
      anchorPostId: null,
      referencePage: null,
      pageIdentity: null,
    })
    await expect(
      repository.startRun({
        ...feed,
        id: randomUUID(),
        runKind: 'backfill',
        resumeFromCheckpoint: false,
        targetStartMs: Date.UTC(2026, 6, 1, 15),
        targetEndMs: Date.UTC(2026, 7, 1, 15),
        startedAt: new Date(now.getTime() + 10_000),
      }),
    ).rejects.toThrow('already has a running run')
    await repository.finishRun(changedRunId, 'interrupted', 'TEST_DONE', new Date(now.getTime() + 11_000))

    // A run left `running` by an abnormal exit must be reconciled at the next
    // app start; otherwise the single-running-run constraint blocks the feed.
    const orphanRunId = randomUUID()
    await repository.startRun({
      ...feed,
      id: orphanRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: false,
      targetStartMs: Date.UTC(2026, 6, 1, 15),
      targetEndMs: Date.UTC(2026, 7, 1, 15),
      startedAt: new Date(now.getTime() + 12_000),
    })
    const reopened = await openOptionalCollectionContext(() => testDatabaseUrl as string, migrationsFolder)
    try {
      expect(reopened.kind).toBe('ready')
      const orphan = await pool.query<{ status: string; stop_reason: string | null; finished_at: Date | null }>(
        'select status, stop_reason, finished_at from runs where id = $1',
        [orphanRunId],
      )
      expect(orphan.rows[0]?.status).toBe('interrupted')
      expect(orphan.rows[0]?.stop_reason).toBe('ORPHANED_RUNNING_RUN')
      expect(orphan.rows[0]?.finished_at).not.toBeNull()

      const unblockedRunId = randomUUID()
      await repository.startRun({
        ...feed,
        id: unblockedRunId,
        runKind: 'backfill',
        resumeFromCheckpoint: false,
        targetStartMs: Date.UTC(2026, 6, 1, 15),
        targetEndMs: Date.UTC(2026, 7, 1, 15),
        startedAt: new Date(now.getTime() + 13_000),
      })
      await repository.finishRun(unblockedRunId, 'interrupted', 'TEST_DONE', new Date(now.getTime() + 14_000))
    } finally {
      await reopened.close()
    }

    // Finishing a job is a fact the database has to hold. It cannot be worked
    // out from the cursor — the cursor is always the time of a post inside the
    // period, so it never crosses the period's start — and a scheduler that
    // infers it re-walks a finished period forever.
    const completionFeed = { feedKind: 'all_articles' as const, menuId: '0' }
    const completionRange = { targetStartMs: Date.UTC(2026, 5, 1, 15), targetEndMs: Date.UTC(2026, 5, 2, 15) }
    const spentRunId = randomUUID()
    await repository.startRun({
      ...completionFeed,
      ...completionRange,
      id: spentRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: false,
      startedAt: new Date(now.getTime() + 20_000),
    })
    await repository.finishRun(spentRunId, 'partial', 'PAGE_BUDGET_SPENT', new Date(now.getTime() + 21_000))
    expect((await repository.readFeedState(completionFeed))?.complete).toBe(false)

    const stoppedRunId = randomUUID()
    await repository.startRun({
      ...completionFeed,
      ...completionRange,
      id: stoppedRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: true,
      startedAt: new Date(now.getTime() + 22_000),
    })
    await repository.finishRun(stoppedRunId, 'interrupted', 'ABORTED', new Date(now.getTime() + 23_000))
    expect((await repository.readFeedState(completionFeed))?.complete).toBe(false)

    const finishedRunId = randomUUID()
    await repository.startRun({
      ...completionFeed,
      ...completionRange,
      id: finishedRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: true,
      startedAt: new Date(now.getTime() + 24_000),
    })
    await repository.finishRun(finishedRunId, 'succeeded', null, new Date(now.getTime() + 25_000))
    expect((await repository.readFeedState(completionFeed))?.complete).toBe(true)

    // A different period is a different job, and it starts unfinished however
    // thoroughly the last one was walked.
    const nextPeriodRunId = randomUUID()
    await repository.startRun({
      ...completionFeed,
      id: nextPeriodRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: false,
      targetStartMs: Date.UTC(2026, 4, 1, 15),
      targetEndMs: Date.UTC(2026, 4, 2, 15),
      startedAt: new Date(now.getTime() + 26_000),
    })
    expect((await repository.readFeedState(completionFeed))?.complete).toBe(false)
    // A run that ends against a period the feed has since moved off must not
    // mark the period it holds now.
    await repository.finishRun(nextPeriodRunId, 'interrupted', 'TEST_DONE', new Date(now.getTime() + 27_000))

    // Forcing rides on the job so that it lets go of itself: the period it was
    // turned on for finishes, and nothing is left reading at three in the
    // morning because somebody forgot a switch.
    const forcedFeed = { feedKind: 'all_articles' as const, menuId: '0' }
    const forcedRange = { targetStartMs: Date.UTC(2026, 3, 1, 15), targetEndMs: Date.UTC(2026, 3, 2, 15) }
    const forcedRunId = randomUUID()
    await repository.startRun({
      ...forcedFeed,
      ...forcedRange,
      id: forcedRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: false,
      startedAt: new Date(now.getTime() + 30_000),
    })
    expect((await repository.readFeedState(forcedFeed))?.forced).toBe(false)

    await repository.setForced(new Date(now.getTime() + 31_000))
    expect((await repository.readFeedState(forcedFeed))?.forced).toBe(true)

    // A block that ran out of pages leaves the job unfinished, so the force
    // has to survive it — that is the whole point of running through a night.
    await repository.finishRun(forcedRunId, 'partial', 'PAGE_BUDGET_SPENT', new Date(now.getTime() + 32_000))
    expect((await repository.readFeedState(forcedFeed))?.forced).toBe(true)

    const forcedLastRunId = randomUUID()
    await repository.startRun({
      ...forcedFeed,
      ...forcedRange,
      id: forcedLastRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: true,
      startedAt: new Date(now.getTime() + 33_000),
    })
    await repository.finishRun(forcedLastRunId, 'succeeded', null, new Date(now.getTime() + 34_000))
    const finished = await repository.readFeedState(forcedFeed)
    expect(finished?.complete).toBe(true)
    expect(finished?.forced).toBe(false)

    // And a period the operator swaps in starts inside the hours again.
    await repository.setForced(new Date(now.getTime() + 35_000))
    const swappedRunId = randomUUID()
    await repository.startRun({
      ...forcedFeed,
      id: swappedRunId,
      runKind: 'backfill',
      resumeFromCheckpoint: false,
      targetStartMs: Date.UTC(2026, 2, 1, 15),
      targetEndMs: Date.UTC(2026, 2, 2, 15),
      startedAt: new Date(now.getTime() + 36_000),
    })
    expect((await repository.readFeedState(forcedFeed))?.forced).toBe(false)
    await repository.finishRun(swappedRunId, 'interrupted', 'TEST_DONE', new Date(now.getTime() + 37_000))

    await pool.query(`update drizzle.__drizzle_migrations set hash = 'intentionally-wrong'`)
    const mismatch = await openOptionalCollectionContext(() => testDatabaseUrl as string, migrationsFolder)
    expect(mismatch).toMatchObject({ kind: 'unavailable', code: 'COLLECTION_SCHEMA_MISMATCH' })
    await mismatch.close()
  })

  it('persists a member page atomically, enforces the single-row state, rejects stale CAS, and preserves first_seen_at', async () => {
    const repo = createMemberRepository(connection.db)
    const run = { id: randomUUID(), runKind: 'backfill' as const, resumeFromCheckpoint: false, startedAt: new Date(1_000) }
    const state = await repo.startRun(run)
    expect(state.stateVersion).toBe(0)

    const stored = await repo.persistPage({ runId: run.id, observedAt: new Date(1_000), referencePage: 1, expectedState: { stateVersion: 0, anchorMemberKey: null }, page: memberPage, totalMemberCount: memberPage.totalMemberCount })
    expect(stored.kind).toBe('stored')

    // A second running run is refused by the whole-table partial unique index.
    await expect(repo.startRun({ id: randomUUID(), runKind: 'incremental', resumeFromCheckpoint: true, startedAt: new Date(2_000) })).rejects.toThrow()
    await repo.finishRun(run.id, 'partial', 'PAGE_BUDGET_SPENT', new Date(2_000))

    // Stale CAS (expects version 0, but it is now 1) conflicts rather than writing.
    const run2 = { id: randomUUID(), runKind: 'incremental' as const, resumeFromCheckpoint: true, startedAt: new Date(3_000) }
    await repo.startRun(run2)
    const conflict = await repo.persistPage({ runId: run2.id, observedAt: new Date(3_000), referencePage: 1, expectedState: { stateVersion: 0, anchorMemberKey: null }, page: memberPage, totalMemberCount: memberPage.totalMemberCount })
    expect(conflict.kind).toBe('conflict')

    // Re-reading the same page keeps first_seen_at and moves snapshot_at.
    const latest = await repo.readMemberFeedState()
    const reobserved = await repo.persistPage({ runId: run2.id, observedAt: new Date(4_000), referencePage: 1, expectedState: { stateVersion: latest!.stateVersion, anchorMemberKey: latest!.anchorMemberKey }, page: memberPage, totalMemberCount: memberPage.totalMemberCount })
    expect(reobserved.kind).toBe('stored')
    const known = await repo.knownMemberKeys(memberPage.items.map((m) => m.memberKey))
    expect(known.size).toBe(memberPage.items.length)

    // Verify that first_seen_at is preserved while snapshot_at advanced.
    const firstKey = memberPage.items[0]!.memberKey
    const row = await connection.db.select({ firstSeenAt: members.firstSeenAt, snapshotAt: members.snapshotAt }).from(members).where(eq(members.memberKey, firstKey))
    expect(row[0]!.firstSeenAt).toEqual(new Date(1_000))
    expect(row[0]!.snapshotAt).toEqual(new Date(4_000))
  })

  it('makes a board job with one row per board, most stored posts first, and replaces it whole', async () => {
    const repository = createCollectionRepository(connection.db)
    // Two boards from the fixture page: the one with more rows on it comes first.
    const counts = new Map<string, number>()
    for (const item of page.items) counts.set(item.boardId, (counts.get(item.boardId) ?? 0) + 1)
    const expected = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)

    const made = await repository.replaceJob({ scope: 'board', targetStartMs: 1_000, targetEndMs: 2_000, at: new Date(5_000) })
    expect(made.map((row) => row.feed.menuId)).toEqual(expected)
    expect(made.map((row) => row.queueOrder)).toEqual(expected.map((_, index) => index + 1))
    expect(made.every((row) => row.boardName !== null)).toBe(true)
    expect(await repository.readFeedState({ feedKind: 'all_articles', menuId: '0' })).toBeNull()

    await repository.markHorizonReached(made[0]!.feed, new Date(6_000))
    expect((await repository.listFeedStates())[0]).toMatchObject({ horizonReached: true })

    await repository.setForced(new Date(7_000))
    expect((await repository.listFeedStates()).every((row) => row.forced)).toBe(true)

    const back = await repository.replaceJob({ scope: 'all_articles', targetStartMs: 1_000, targetEndMs: 2_000, at: new Date(8_000) })
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ feed: { feedKind: 'all_articles', menuId: '0' }, horizonReached: false, forced: false })
  })

  it('describes a board job board by board', async () => {
    const repository = createCollectionRepository(connection.db)
    const status = createCollectionStatusQuery(connection.db)
    const made = await repository.replaceJob({ scope: 'board', targetStartMs: 1_000, targetEndMs: 2_000_000_000_000, at: new Date(5_000) })
    const first = made[0]!
    const runId = randomUUID()
    const state = await repository.startRun({ ...first.feed, id: runId, runKind: 'development', resumeFromCheckpoint: true, targetStartMs: first.targetStartMs, targetEndMs: first.targetEndMs, startedAt: new Date(6_000) })
    const own = { ...page, items: page.items.filter((item) => item.boardId === first.feed.menuId) }
    await repository.persistPage({ feed: first.feed, runId, observedAt: new Date(7_000), referencePage: 1, expectedState: state, page: own })

    const read = await status.read()
    expect(read.job).toMatchObject({ scope: 'board', complete: false })
    expect(read.job?.boards[0]).toMatchObject({ queueOrder: 1, boardId: first.feed.menuId, name: first.boardName, state: 'walking', insertedPostCount: 0 })
    expect(read.job?.boards[1]).toMatchObject({ queueOrder: 2, state: 'waiting', cursorPostedAtMs: null })
    expect(read.running?.boardName).toBe(first.boardName)
  })
})
