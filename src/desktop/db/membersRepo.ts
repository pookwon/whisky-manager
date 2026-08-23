import { and, eq, lt, sql } from 'drizzle-orm'
import type { RawMember } from '../../shared/members.js'
import type { AppDatabase } from './client.js'
import { members } from './schema.js'

export interface MembersRepo {
  joinDateOf(cafeId: string, memberKey: string): string | null
  upsertMany(cafeId: string, batch: readonly RawMember[]): void
  /** True before the first successful refresh, which is what starts the window. */
  isEmpty(cafeId: string): boolean
  /** Removes members who joined strictly before `oldestJoinDate`. */
  prune(cafeId: string, oldestJoinDate: string): void
}

export function createMembersRepo(db: AppDatabase): MembersRepo {
  return {
    joinDateOf(cafeId, memberKey) {
      const row = db
        .select()
        .from(members)
        .where(and(eq(members.cafeId, cafeId), eq(members.memberKey, memberKey)))
        .get()
      return row?.joinDate ?? null
    },

    upsertMany(cafeId, batch) {
      if (batch.length === 0) return
      db.transaction((tx) => {
        for (const member of batch) {
          tx.insert(members)
            .values({ cafeId, memberKey: member.memberKey, joinDate: member.joinDate })
            .onConflictDoUpdate({
              target: [members.cafeId, members.memberKey],
              set: { joinDate: member.joinDate },
            })
            .run()
        }
      })
    },

    isEmpty(cafeId) {
      const row = db
        .select({ count: sql<number>`count(*)` })
        .from(members)
        .where(eq(members.cafeId, cafeId))
        .get()
      return (row?.count ?? 0) === 0
    },

    // String comparison is date comparison here: the cafe zero-pads every field.
    prune(cafeId, oldestJoinDate) {
      db.delete(members)
        .where(and(eq(members.cafeId, cafeId), lt(members.joinDate, oldestJoinDate)))
        .run()
    },
  }
}
