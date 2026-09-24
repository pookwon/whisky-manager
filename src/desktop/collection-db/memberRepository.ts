import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CollectedMemberPage } from '../../shared/cafeMemberList.js'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'
import { assertPersistablePage, MemberStateConflictError, writeMemberPage } from './memberPageWrite.js'

/** The single member-feed row's fixed primary key. */
const FEED_ROW_ID = 1

export interface MemberFeedStateExpectation {
  readonly stateVersion: number
  readonly anchorMemberKey: string | null
}

/** What a walk needs of a cursor to resume and to commit against it. */
export interface MemberCursorState extends MemberFeedStateExpectation {
  readonly anchorJoinDate: string | null
  readonly referencePage: number | null
  readonly pageIdentity: string | null
  readonly cursorUpdatedAtMs: number
}

export interface MemberFeedState extends MemberCursorState {
  readonly totalMemberCount: number | null
  readonly complete: boolean
  /** When the first walk reached the last page; null while `complete` is false. */
  readonly completedAtMs: number | null
  readonly forced: boolean
  readonly toppedUpAtMs: number | null
}

export interface CreateMemberRunInput {
  readonly id: string
  readonly runKind: 'backfill' | 'incremental' | 'topup' | 'resync'
  readonly resumeFromCheckpoint: boolean
  readonly startedAt: Date
}

export interface PersistMemberPageInput {
  readonly runId: string
  readonly observedAt: Date
  readonly referencePage: number
  readonly expectedState: MemberFeedStateExpectation
  readonly page: CollectedMemberPage
  /**
   * Approximate cafe total from the page's paging block; a null does not
   * overwrite a previously stored value — use null when the page carries none.
   */
  readonly totalMemberCount: number | null
}

export type PersistMemberPageResult =
  | {
      readonly kind: 'stored'
      readonly insertedMemberCount: number
      readonly updatedMemberCount: number
      readonly nextStateVersion: number
      readonly anchorMemberKey: string
    }
  | { readonly kind: 'conflict' }

/**
 * What one walk over the member list needs of its storage. Every walk writes
 * the same member rows and run rows; they differ in which cursor they advance
 * and what "done" marks.
 */
export interface MemberWalkRepository {
  startRun(input: CreateMemberRunInput): Promise<MemberCursorState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  persistPage(input: PersistMemberPageInput): Promise<PersistMemberPageResult>
  markCompleted(finishedAt: Date): Promise<void>
  markToppedUp(finishedAt: Date): Promise<void>
  knownMemberKeys(keys: readonly string[]): Promise<Set<string>>
}

export interface MemberRepository extends MemberWalkRepository {
  readMemberFeedState(): Promise<MemberFeedState | null>
  startRun(input: CreateMemberRunInput): Promise<MemberFeedState>
  setForced(forcedAt: Date | null): Promise<void>
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
}

function toState(row: {
  stateVersion: number
  anchorMemberKey: string | null
  anchorJoinDate: string | null
  referencePage: number | null
  pageIdentity: string | null
  totalMemberCount: number | null
  completedAt: Date | null
  toppedUpAt: Date | null
  forcedAt: Date | null
  updatedAt: Date
}): MemberFeedState {
  return {
    stateVersion: row.stateVersion,
    anchorMemberKey: row.anchorMemberKey,
    anchorJoinDate: row.anchorJoinDate,
    referencePage: row.referencePage,
    pageIdentity: row.pageIdentity,
    totalMemberCount: row.totalMemberCount,
    cursorUpdatedAtMs: row.updatedAt.getTime(),
    complete: row.completedAt !== null,
    completedAtMs: row.completedAt?.getTime() ?? null,
    forced: row.forcedAt !== null,
    toppedUpAtMs: row.toppedUpAt?.getTime() ?? null,
  }
}

const STATE_COLUMNS = {
  stateVersion: memberFeedState.stateVersion,
  anchorMemberKey: memberFeedState.anchorMemberKey,
  anchorJoinDate: memberFeedState.anchorJoinDate,
  referencePage: memberFeedState.referencePage,
  pageIdentity: memberFeedState.pageIdentity,
  totalMemberCount: memberFeedState.totalMemberCount,
  completedAt: memberFeedState.completedAt,
  toppedUpAt: memberFeedState.toppedUpAt,
  forcedAt: memberFeedState.forcedAt,
  updatedAt: memberFeedState.updatedAt,
}

export function createMemberRepository(db: CollectionDatabase): MemberRepository {
  return {
    async readMemberFeedState() {
      const rows = await db.select(STATE_COLUMNS).from(memberFeedState).where(eq(memberFeedState.id, FEED_ROW_ID)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toState(row)
    },

    async startRun(input) {
      return await db.transaction(async (tx) => {
        await tx
          .insert(memberFeedState)
          .values({ id: FEED_ROW_ID, stateVersion: 0, updatedAt: input.startedAt })
          .onConflictDoNothing()
        const rows = await tx.select(STATE_COLUMNS).from(memberFeedState).where(eq(memberFeedState.id, FEED_ROW_ID)).for('update')
        const current = rows[0]
        if (current === undefined) throw new Error('member feed state does not exist')
        const running = await tx.select({ id: memberRuns.id }).from(memberRuns).where(eq(memberRuns.status, 'running')).limit(1)
        if (running.length > 0) throw new Error('member feed already has a running run')
        await tx.insert(memberRuns).values({
          id: input.id,
          runKind: input.runKind,
          status: 'running',
          startedAt: input.startedAt,
        })
        return toState(current)
      })
    },

    async recordPageRequest(id, phase) {
      const updated = await db
        .update(memberRuns)
        .set({
          requestPages: sql`${memberRuns.requestPages} + 1`,
          ...(phase === 'probe' ? { discoveryPages: sql`${memberRuns.discoveryPages} + 1` } : {}),
        })
        .where(eq(memberRuns.id, id))
        .returning({ id: memberRuns.id })
      if (updated.length !== 1) throw new Error('member run does not exist')
    },

    async finishRun(id, status, stopReason, finishedAt) {
      const updated = await db
        .update(memberRuns)
        .set({ status, stopReason, finishedAt })
        .where(and(eq(memberRuns.id, id), eq(memberRuns.status, 'running')))
        .returning({ id: memberRuns.id })
      if (updated.length !== 1) throw new Error('member run is not running')
    },

    async markCompleted(finishedAt) {
      // The force goes with it: the walk it was turned on for is done.
      await db.update(memberFeedState).set({ completedAt: finishedAt, forcedAt: null }).where(eq(memberFeedState.id, FEED_ROW_ID))
    },

    async markToppedUp(finishedAt) {
      await db.update(memberFeedState).set({ toppedUpAt: finishedAt }).where(eq(memberFeedState.id, FEED_ROW_ID))
    },

    async setForced(forcedAt) {
      await db.update(memberFeedState).set({ forcedAt }).where(eq(memberFeedState.id, FEED_ROW_ID))
    },

    async reconcileOrphanedRuns(finishedAt) {
      const repaired = await db
        .update(memberRuns)
        .set({ status: 'interrupted', stopReason: 'ORPHANED_RUNNING_RUN', finishedAt })
        .where(eq(memberRuns.status, 'running'))
        .returning({ id: memberRuns.id })
      return repaired.length
    },

    async knownMemberKeys(keys) {
      if (keys.length === 0) return new Set<string>()
      const rows = await db.select({ memberKey: members.memberKey }).from(members).where(inArray(members.memberKey, [...keys]))
      return new Set(rows.map((row) => row.memberKey))
    },

    async persistPage(input) {
      const items = assertPersistablePage(input)

      try {
        return await db.transaction(async (tx) => {
          const written = await writeMemberPage(tx, input, items)
          const { anchor } = written

          const stateUpdated = await tx
            .update(memberFeedState)
            .set({
              stateVersion: input.expectedState.stateVersion + 1,
              anchorMemberKey: anchor.memberKey,
              anchorJoinDate: anchor.joinDate,
              pageIdentity: input.page.pageIdentity,
              referencePage: input.referencePage,
              lastRunId: input.runId,
              updatedAt: input.observedAt,
              ...(input.totalMemberCount !== null ? { totalMemberCount: input.totalMemberCount } : {}),
            })
            .where(
              and(
                eq(memberFeedState.id, FEED_ROW_ID),
                eq(memberFeedState.stateVersion, input.expectedState.stateVersion),
                sql`${memberFeedState.anchorMemberKey} is not distinct from ${input.expectedState.anchorMemberKey}`,
              ),
            )
            .returning({ stateVersion: memberFeedState.stateVersion })
          if (stateUpdated.length !== 1) throw new MemberStateConflictError()

          return {
            kind: 'stored' as const,
            insertedMemberCount: written.insertedMemberCount,
            updatedMemberCount: written.updatedMemberCount,
            nextStateVersion: stateUpdated[0]?.stateVersion ?? input.expectedState.stateVersion + 1,
            anchorMemberKey: anchor.memberKey,
          }
        })
      } catch (error) {
        if (error instanceof MemberStateConflictError) return { kind: 'conflict' }
        throw error
      }
    },
  }
}
