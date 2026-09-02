import { and, eq, inArray, sql } from 'drizzle-orm'
import type { CollectedMember, CollectedMemberPage } from '../../shared/cafeMemberList.js'
import type { CollectionDatabase } from './client.js'
import { members, memberFeedState, memberRuns } from './memberSchema.js'

/** The single member-feed row's fixed primary key. */
const FEED_ROW_ID = 1

export interface MemberFeedStateExpectation {
  readonly stateVersion: number
  readonly anchorMemberKey: string | null
}

export interface MemberFeedState extends MemberFeedStateExpectation {
  readonly anchorJoinDate: string | null
  readonly referencePage: number | null
  readonly pageIdentity: string | null
  readonly totalMemberCount: number | null
  readonly cursorUpdatedAtMs: number
  readonly complete: boolean
  readonly forced: boolean
  readonly toppedUpAtMs: number | null
}

export interface CreateMemberRunInput {
  readonly id: string
  readonly runKind: 'backfill' | 'incremental' | 'topup'
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

export interface MemberRepository {
  readMemberFeedState(): Promise<MemberFeedState | null>
  startRun(input: CreateMemberRunInput): Promise<MemberFeedState>
  recordPageRequest(id: string, phase: 'probe' | 'collection'): Promise<void>
  finishRun(id: string, status: 'succeeded' | 'partial' | 'failed' | 'interrupted', stopReason: string | null, finishedAt: Date): Promise<void>
  persistPage(input: PersistMemberPageInput): Promise<PersistMemberPageResult>
  markCompleted(finishedAt: Date): Promise<void>
  markToppedUp(finishedAt: Date): Promise<void>
  setForced(forcedAt: Date | null): Promise<void>
  reconcileOrphanedRuns(finishedAt: Date): Promise<number>
  knownMemberKeys(keys: readonly string[]): Promise<Set<string>>
}

class MemberStateConflictError extends Error {
  constructor() {
    super('member feed state changed before this page could commit')
    this.name = 'MemberStateConflictError'
  }
}

function assertPersistablePage(input: PersistMemberPageInput): readonly CollectedMember[] {
  if (!Number.isSafeInteger(input.referencePage) || input.referencePage < 1) {
    throw new Error('referencePage must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.expectedState.stateVersion) || input.expectedState.stateVersion < 0) {
    throw new Error('expected stateVersion must be a nonnegative safe integer')
  }
  if (input.page.items.length === 0) {
    throw new Error('an empty member page must be handled by orchestration, not persisted')
  }
  const seen = new Set<string>()
  for (const item of input.page.items) {
    if (seen.has(item.memberKey)) throw new Error('page has a duplicate member key')
    seen.add(item.memberKey)
  }
  return input.page.items
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
      const anchor = items.at(-1)
      if (anchor === undefined) throw new Error('persistable page unexpectedly has no members')

      try {
        return await db.transaction(async (tx) => {
          const existingRows = await tx
            .select({ memberKey: members.memberKey })
            .from(members)
            .where(inArray(members.memberKey, items.map((item) => item.memberKey)))
          const existing = new Set(existingRows.map((row) => row.memberKey))
          const insertedMemberCount = items.filter((item) => !existing.has(item.memberKey)).length
          const updatedMemberCount = items.length - insertedMemberCount

          // A re-read updates in place: nickname, level, roles and snapshot move;
          // first_seen_at stays what it was.
          await tx
            .insert(members)
            .values(
              items.map((item) => ({
                memberKey: item.memberKey,
                nickname: item.nickname,
                joinDate: item.joinDate,
                levelName: item.levelName,
                isManager: item.isManager,
                isStaff: item.isStaff,
                snapshotAt: input.observedAt,
                firstSeenAt: input.observedAt,
                lastRunId: input.runId,
              })),
            )
            .onConflictDoUpdate({
              target: members.memberKey,
              set: {
                nickname: sql`excluded.nickname`,
                joinDate: sql`excluded.join_date`,
                levelName: sql`excluded.level_name`,
                isManager: sql`excluded.is_manager`,
                isStaff: sql`excluded.is_staff`,
                snapshotAt: input.observedAt,
                lastRunId: input.runId,
              },
            })

          const updatedRun = await tx
            .update(memberRuns)
            .set({
              collectionPages: sql`${memberRuns.collectionPages} + 1`,
              observedMemberCount: sql`${memberRuns.observedMemberCount} + ${items.length}`,
              insertedMemberCount: sql`${memberRuns.insertedMemberCount} + ${insertedMemberCount}`,
              updatedMemberCount: sql`${memberRuns.updatedMemberCount} + ${updatedMemberCount}`,
              lastCommittedMemberKey: anchor.memberKey,
              lastCommittedPage: input.referencePage,
            })
            .where(eq(memberRuns.id, input.runId))
            .returning({ id: memberRuns.id })
          if (updatedRun.length !== 1) throw new Error('member run does not exist')

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
            insertedMemberCount,
            updatedMemberCount,
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
