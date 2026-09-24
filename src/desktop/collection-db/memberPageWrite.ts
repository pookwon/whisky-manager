import { eq, inArray, sql } from 'drizzle-orm'
import type { CollectedMember } from '../../shared/cafeMemberList.js'
import type { CollectionDatabase } from './client.js'
import type { PersistMemberPageInput } from './memberRepository.js'
import { members, memberRuns } from './memberSchema.js'

/** The handle a `db.transaction` callback receives. */
export type CollectionTransaction = Parameters<Parameters<CollectionDatabase['transaction']>[0]>[0]

/** Thrown inside a page's transaction when its cursor moved underneath it; rolls the page back. */
export class MemberStateConflictError extends Error {
  constructor() {
    super('member cursor changed before this page could commit')
    this.name = 'MemberStateConflictError'
  }
}

export function assertPersistablePage(input: PersistMemberPageInput): readonly CollectedMember[] {
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

export interface WrittenMemberPage {
  readonly insertedMemberCount: number
  readonly updatedMemberCount: number
  /** The page's tail member, which becomes the cursor's anchor. */
  readonly anchor: CollectedMember
}

/**
 * The part of committing a page every walk shares: the member rows and the
 * run's counters. Which cursor then moves is the caller's, inside the same
 * transaction, so a page and its cursor commit or roll back together.
 */
export async function writeMemberPage(
  tx: CollectionTransaction,
  input: PersistMemberPageInput,
  items: readonly CollectedMember[],
): Promise<WrittenMemberPage> {
  const anchor = items.at(-1)
  if (anchor === undefined) throw new Error('persistable page unexpectedly has no members')

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
        ageGroup: item.ageGroup,
        sex: item.sex,
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
        ageGroup: sql`excluded.age_group`,
        sex: sql`excluded.sex`,
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

  return { insertedMemberCount, updatedMemberCount, anchor }
}
