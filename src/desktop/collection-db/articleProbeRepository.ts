import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { CAFE_ARTICLE_LIST } from '../../shared/cafeArticleFixture.js'
import { kstDayKeyRange } from '../../shared/kst.js'
import type { ArticleProbeVerdict } from '../articleProbeVerdict.js'
import { articleProbe } from './articleProbeSchema.js'
import type { CollectionDatabase } from './client.js'
import { writePostRows } from './postPageWrite.js'
import type { CollectionRepository } from './repository.js'
import { boards, collectionRuns, posts } from './schema.js'

type RunStatus = (typeof collectionRuns.$inferSelect)['status']

/** The job in hand: its window and how its ids were answered. */
export interface ArticleProbeJob {
  /** KST `yyyymmdd`: the search job's window, as it was when the job was made. */
  readonly fromDay: string
  /** KST `yyyymmdd`, the search's own inclusive end; the ids come from posts before this day's 00:00. */
  readonly toDay: string
  readonly total: number
  readonly probed: number
  readonly stored: number
  readonly deleted: number
  readonly unreadable: number
  readonly otherBoard: number
  readonly notice: number
}

export interface ArticleProbeLastRun {
  readonly status: RunStatus
  readonly stopReason: string | null
  readonly startedAtMs: number
}

export interface ArticleProbeWindowDays {
  readonly fromDay: string
  readonly toDay: string
}

export interface ArticleProbeRunInput {
  readonly id: string
  readonly fromDay: string
  readonly toDay: string
  readonly startedAt: Date
}

export interface RecordArticleVerdictInput {
  readonly runId: string
  readonly postId: string
  readonly observedAt: Date
  readonly verdict: ArticleProbeVerdict
  /** Whether a request answered it. An id found already stored costs none and is not counted as read. */
  readonly requested: boolean
}

export interface ArticleProbeRepository {
  /** The job of exactly this window; null when none was made for it. */
  readJob(window: ArticleProbeWindowDays): Promise<ArticleProbeJob | null>
  /**
   * Puts every id missing between the first and last post stored in the window
   * into the job, and says how many. Refused while any id of any window waits;
   * ids an earlier window answered are left as they are.
   */
  createJob(window: ArticleProbeWindowDays): Promise<number>
  /** The boards whose live posts are stored; the rest are recorded as another board's. */
  listCollectedBoardIds(): Promise<readonly string[]>
  /** The smallest id of this window not yet answered; null when every id is. */
  nextWaitingId(window: ArticleProbeWindowDays): Promise<string | null>
  /** The board of the stored post with this id; null when none is stored. */
  storedBoardOf(postId: string): Promise<string | null>
  startRun(input: ArticleProbeRunInput): Promise<void>
  recordPageRequest(runId: string): Promise<void>
  /** Answers one waiting id, and writes its post with it when it is one to store. */
  recordVerdict(input: RecordArticleVerdictInput): Promise<void>
  finishRun(runId: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  /**
   * Marks probe runs left `running` as interrupted, as the startup sweep does
   * for every feed. Only for a caller holding the collection lock: then no
   * probe run is being written, and a running one is one nothing will close.
   */
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  /** The newest probe run: probe runs stay off the recent log, so the card reads it here. */
  readLastRun(): Promise<ArticleProbeLastRun | null>
}

const NOTHING_WRITTEN = { insertedPostCount: 0, updatedPostCount: 0 } as const

function boardOf(verdict: ArticleProbeVerdict): string | null {
  return verdict.outcome === 'stored' || verdict.outcome === 'other_board' || verdict.outcome === 'notice' ? verdict.boardId : null
}

export function createArticleProbeRepository(db: CollectionDatabase, collection: CollectionRepository): ArticleProbeRepository {
  return {
    async readJob(window) {
      const rows = await db
        .select({
          fromDay: articleProbe.windowFromDay,
          toDay: articleProbe.windowToDay,
          total: sql<string>`count(*)`,
          probed: sql<string>`count(${articleProbe.outcome})`,
          stored: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'stored')`,
          deleted: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'deleted')`,
          unreadable: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'unreadable')`,
          otherBoard: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'other_board')`,
          notice: sql<string>`count(*) filter (where ${articleProbe.outcome} = 'notice')`,
        })
        .from(articleProbe)
        .where(and(eq(articleProbe.windowFromDay, window.fromDay), eq(articleProbe.windowToDay, window.toDay)))
        .groupBy(articleProbe.windowFromDay, articleProbe.windowToDay)
      const row = rows[0]
      if (row === undefined) return null
      return {
        fromDay: row.fromDay,
        toDay: row.toDay,
        total: Number(row.total),
        probed: Number(row.probed),
        stored: Number(row.stored),
        deleted: Number(row.deleted),
        unreadable: Number(row.unreadable),
        otherBoard: Number(row.otherBoard),
        notice: Number(row.notice),
      }
    },

    async createJob(window) {
      const startAt = new Date(kstDayKeyRange(window.fromDay).startMs)
      const endAt = new Date(kstDayKeyRange(window.toDay).startMs)
      return await db.transaction(async (tx) => {
        const waiting = await tx.select({ postId: articleProbe.postId }).from(articleProbe).where(isNull(articleProbe.outcome)).limit(1)
        if (waiting.length > 0) throw new Error('an article probe job still has ids waiting; finish it before making another')
        // Each stored post and the next one up bound a hole; the holes of the
        // stretch between the window's first and last stored post are the job.
        // Walking the stored ids once with lead() takes a fraction of a second
        // where asking about every id of the span one by one took minutes. An
        // id an earlier window answered keeps its answer and stays in that
        // window: it is never read again.
        const inserted = await tx.execute(sql`
          insert into ${articleProbe} (post_id, window_from_day, window_to_day)
          select missing.id, ${window.fromDay}, ${window.toDay}
          from (
            select ${posts.postId}::bigint as id, lead(${posts.postId}::bigint) over (order by ${posts.postId}::bigint) as next_id
            from ${posts}
            where ${posts.postId}::bigint between
              (select min(${posts.postId}::bigint) from ${posts} where ${posts.postedAt} >= ${startAt} and ${posts.postedAt} < ${endAt})
              and (select max(${posts.postId}::bigint) from ${posts} where ${posts.postedAt} >= ${startAt} and ${posts.postedAt} < ${endAt})
          ) as stored
          cross join lateral generate_series(stored.id + 1, stored.next_id - 1) as missing(id)
          where stored.next_id > stored.id + 1
          on conflict (post_id) do nothing`)
        return inserted.rowCount ?? 0
      })
    },

    async listCollectedBoardIds() {
      const rows = await db.select({ boardId: boards.boardId }).from(boards).where(eq(boards.collectEnabled, true))
      return rows.map((row) => row.boardId)
    },

    async nextWaitingId(window) {
      const rows = await db
        .select({ postId: articleProbe.postId })
        .from(articleProbe)
        .where(and(isNull(articleProbe.outcome), eq(articleProbe.windowFromDay, window.fromDay), eq(articleProbe.windowToDay, window.toDay)))
        .orderBy(asc(articleProbe.postId))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : String(row.postId)
    },

    async storedBoardOf(postId) {
      const rows = await db.select({ boardId: posts.boardId }).from(posts).where(eq(posts.postId, postId)).limit(1)
      return rows[0]?.boardId ?? null
    },

    async startRun(input) {
      await db.insert(collectionRuns).values({
        id: input.id,
        feedKind: 'article_probe',
        menuId: CAFE_ARTICLE_LIST.menuId,
        runKind: 'backfill',
        targetStartMs: kstDayKeyRange(input.fromDay).startMs,
        targetEndMs: kstDayKeyRange(input.toDay).startMs,
        status: 'running',
        startedAt: input.startedAt,
      })
    },

    recordPageRequest(runId) {
      return collection.recordPageRequest(runId, 'collection')
    },

    async recordVerdict(input) {
      const { verdict } = input
      await db.transaction(async (tx) => {
        const written = verdict.outcome === 'stored' && verdict.post !== null
          ? await writePostRows(tx, [verdict.post], input.observedAt, input.runId)
          : NOTHING_WRITTEN
        const answered = await tx
          .update(articleProbe)
          .set({
            outcome: verdict.outcome,
            boardId: boardOf(verdict),
            errorCode: verdict.outcome === 'unreadable' ? verdict.errorCode : null,
            probedAt: input.observedAt,
            runId: input.runId,
          })
          .where(and(eq(articleProbe.postId, Number(input.postId)), isNull(articleProbe.outcome)))
          .returning({ postId: articleProbe.postId })
        if (answered.length !== 1) throw new Error('article probe id is not waiting for an answer')
        if (!input.requested) return
        const run = await tx
          .update(collectionRuns)
          .set({
            collectionPages: sql`${collectionRuns.collectionPages} + 1`,
            observedPostCount: sql`${collectionRuns.observedPostCount} + ${written.insertedPostCount + written.updatedPostCount}`,
            insertedPostCount: sql`${collectionRuns.insertedPostCount} + ${written.insertedPostCount}`,
            updatedPostCount: sql`${collectionRuns.updatedPostCount} + ${written.updatedPostCount}`,
            lastCommittedPostId: input.postId,
          })
          .where(eq(collectionRuns.id, input.runId))
          .returning({ id: collectionRuns.id })
        if (run.length !== 1) throw new Error('article probe run does not exist')
      })
    },

    async finishRun(runId, status, stopReason, finishedAt) {
      const updated = await db
        .update(collectionRuns)
        .set({ status, stopReason, finishedAt })
        .where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, 'running')))
        .returning({ id: collectionRuns.id })
      if (updated.length !== 1) throw new Error('article probe run is not running')
    },

    async reconcileOrphanedRuns(finishedAt) {
      const repaired = await db
        .update(collectionRuns)
        .set({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', finishedAt })
        .where(and(eq(collectionRuns.feedKind, 'article_probe'), eq(collectionRuns.status, 'running')))
        .returning({ id: collectionRuns.id })
      return repaired.length
    },

    async readLastRun() {
      const rows = await db
        .select({ status: collectionRuns.status, stopReason: collectionRuns.stopReason, startedAt: collectionRuns.startedAt })
        .from(collectionRuns)
        .where(eq(collectionRuns.feedKind, 'article_probe'))
        .orderBy(desc(collectionRuns.startedAt))
        .limit(1)
      const row = rows[0]
      return row === undefined ? null : { status: row.status, stopReason: row.stopReason, startedAtMs: row.startedAt.getTime() }
    },
  }
}
