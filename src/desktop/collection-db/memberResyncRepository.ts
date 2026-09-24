import { and, desc, eq, sql } from 'drizzle-orm'
import type { CollectionDatabase } from './client.js'
import type { MemberCursorState, MemberRepository, MemberWalkRepository } from './memberRepository.js'
import { assertPersistablePage, MemberStateConflictError, writeMemberPage } from './memberPageWrite.js'
import { memberResyncState } from './memberResyncSchema.js'
import { memberRuns } from './memberSchema.js'

/** The single re-walk row's fixed primary key. */
const RESYNC_ROW_ID = 1

/** Where the re-walk stands; `inProgress` once a cycle has started and until it reaches the last page. */
export interface MemberResyncState extends MemberCursorState {
  readonly cycleStartedAtMs: number | null
  readonly completedAtMs: number | null
  readonly inProgress: boolean
}

/** How the most recent re-walk run ended, for the card's stop line. */
export interface MemberResyncLastRun {
  readonly status: string
  readonly stopReason: string | null
}

export interface MemberResyncRepository extends MemberWalkRepository {
  readResyncState(): Promise<MemberResyncState | null>
  readLastRun(): Promise<MemberResyncLastRun | null>
}

const STATE_COLUMNS = {
  stateVersion: memberResyncState.stateVersion,
  anchorMemberKey: memberResyncState.anchorMemberKey,
  anchorJoinDate: memberResyncState.anchorJoinDate,
  referencePage: memberResyncState.referencePage,
  pageIdentity: memberResyncState.pageIdentity,
  cycleStartedAt: memberResyncState.cycleStartedAt,
  completedAt: memberResyncState.completedAt,
  updatedAt: memberResyncState.updatedAt,
}

function toState(row: {
  stateVersion: number
  anchorMemberKey: string | null
  anchorJoinDate: string | null
  referencePage: number | null
  pageIdentity: string | null
  cycleStartedAt: Date | null
  completedAt: Date | null
  updatedAt: Date
}): MemberResyncState {
  return {
    stateVersion: row.stateVersion,
    anchorMemberKey: row.anchorMemberKey,
    anchorJoinDate: row.anchorJoinDate,
    referencePage: row.referencePage,
    pageIdentity: row.pageIdentity,
    cursorUpdatedAtMs: row.updatedAt.getTime(),
    cycleStartedAtMs: row.cycleStartedAt?.getTime() ?? null,
    completedAtMs: row.completedAt?.getTime() ?? null,
    inProgress: row.cycleStartedAt !== null && row.completedAt === null,
  }
}

/**
 * The periodic re-walk of the whole member list. It writes the same member and
 * run rows as the first walk — through `members` it shares everything — but
 * moves its own cursor, so the daily top-up can keep rewinding the feed's.
 *
 * A cycle begins with the first run after the previous one completed: that run
 * clears the cursor, so the walk starts from page 1 again.
 */
export function createMemberResyncRepository(db: CollectionDatabase, feed: MemberRepository): MemberResyncRepository {
  return {
    async readResyncState() {
      const rows = await db.select(STATE_COLUMNS).from(memberResyncState).where(eq(memberResyncState.id, RESYNC_ROW_ID)).limit(1)
      const row = rows[0]
      return row === undefined ? null : toState(row)
    },

    async readLastRun() {
      const rows = await db
        .select({ status: memberRuns.status, stopReason: memberRuns.stopReason })
        .from(memberRuns)
        .where(eq(memberRuns.runKind, 'resync'))
        .orderBy(desc(memberRuns.startedAt))
        .limit(1)
      return rows[0] ?? null
    },

    async startRun(input) {
      return await db.transaction(async (tx) => {
        await tx
          .insert(memberResyncState)
          .values({ id: RESYNC_ROW_ID, stateVersion: 0, updatedAt: input.startedAt })
          .onConflictDoNothing()
        const rows = await tx.select(STATE_COLUMNS).from(memberResyncState).where(eq(memberResyncState.id, RESYNC_ROW_ID)).for('update')
        const current = rows[0]
        if (current === undefined) throw new Error('member resync state does not exist')
        const running = await tx.select({ id: memberRuns.id }).from(memberRuns).where(eq(memberRuns.status, 'running')).limit(1)
        if (running.length > 0) throw new Error('member feed already has a running run')
        await tx.insert(memberRuns).values({ id: input.id, runKind: input.runKind, status: 'running', startedAt: input.startedAt })

        if (toState(current).inProgress) return toState(current)
        const cycle = {
          stateVersion: current.stateVersion + 1,
          anchorMemberKey: null,
          anchorJoinDate: null,
          referencePage: null,
          pageIdentity: null,
          cycleStartedAt: input.startedAt,
          completedAt: null,
          updatedAt: input.startedAt,
        }
        await tx.update(memberResyncState).set({ ...cycle, lastRunId: input.id }).where(eq(memberResyncState.id, RESYNC_ROW_ID))
        return toState(cycle)
      })
    },

    async persistPage(input) {
      const items = assertPersistablePage(input)
      try {
        return await db.transaction(async (tx) => {
          const written = await writeMemberPage(tx, input, items)
          const { anchor } = written
          const stateUpdated = await tx
            .update(memberResyncState)
            .set({
              stateVersion: input.expectedState.stateVersion + 1,
              anchorMemberKey: anchor.memberKey,
              anchorJoinDate: anchor.joinDate,
              pageIdentity: input.page.pageIdentity,
              referencePage: input.referencePage,
              lastRunId: input.runId,
              updatedAt: input.observedAt,
            })
            .where(
              and(
                eq(memberResyncState.id, RESYNC_ROW_ID),
                eq(memberResyncState.stateVersion, input.expectedState.stateVersion),
                sql`${memberResyncState.anchorMemberKey} is not distinct from ${input.expectedState.anchorMemberKey}`,
              ),
            )
            .returning({ stateVersion: memberResyncState.stateVersion })
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

    async markCompleted(finishedAt) {
      await db.update(memberResyncState).set({ completedAt: finishedAt }).where(eq(memberResyncState.id, RESYNC_ROW_ID))
    },

    // The run rows and the member rows are the feed's own; only the cursor differs.
    recordPageRequest: (id, phase) => feed.recordPageRequest(id, phase),
    finishRun: (id, status, stopReason, finishedAt) => feed.finishRun(id, status, stopReason, finishedAt),
    markToppedUp: () => Promise.reject(new Error('a member re-walk never tops up')),
    knownMemberKeys: (keys) => feed.knownMemberKeys(keys),
  }
}
