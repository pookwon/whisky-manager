import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseCafeArticleListText } from '../../../src/shared/cafeArticleList.js'
import { openCollectionDatabase, type CollectionDatabaseConnection } from '../../../src/desktop/collection-db/client.js'
import { createCollectionRepository } from '../../../src/desktop/collection-db/repository.js'
import { openOptionalCollectionContext } from '../../../src/desktop/collectionContext.js'
import { createCollectionStatusQuery } from '../../../src/desktop/collection-db/statusQuery.js'

const testDatabaseUrl = process.env.COLLECTION_TEST_DATABASE_URL?.trim()
const integration = testDatabaseUrl === undefined || testDatabaseUrl === '' ? describe.skip : describe
const migrationsFolder = fileURLToPath(new URL('../../../drizzle-collection', import.meta.url))
const page = parseCafeArticleListText(
  readFileSync(fileURLToPath(new URL('../../fixtures/cafe-article-list-page-1.json', import.meta.url)), 'utf8'),
)

const COLLECTION_TABLES = ['posts', 'boards', 'feed_state', 'runs']
const COLLECTION_TYPES = ['collection_feed_kind', 'collection_run_kind', 'collection_run_status']

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
    const whileRunning = await status.read(feed)
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

    const afterFinish = await status.read(feed)
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
    const reopened = await openOptionalCollectionContext({ DATABASE_URL: testDatabaseUrl }, migrationsFolder)
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

    await pool.query(`update drizzle.__drizzle_migrations set hash = 'intentionally-wrong'`)
    const mismatch = await openOptionalCollectionContext({ DATABASE_URL: testDatabaseUrl }, migrationsFolder)
    expect(mismatch).toMatchObject({ kind: 'unavailable', code: 'COLLECTION_SCHEMA_MISMATCH' })
    await mismatch.close()
  })
})
