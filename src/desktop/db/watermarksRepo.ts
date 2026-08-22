import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from './client.js'
import { watermarks } from './schema.js'

export interface WatermarksRepo {
  get(automationId: string, cafeId: string, boardId: string): string | null
  set(automationId: string, cafeId: string, boardId: string, lastSeenPostId: string, updatedAt: number): void
}

export function createWatermarksRepo(db: AppDatabase): WatermarksRepo {
  return {
    get(automationId, cafeId, boardId) {
      const row = db
        .select()
        .from(watermarks)
        .where(
          and(
            eq(watermarks.automationId, automationId),
            eq(watermarks.cafeId, cafeId),
            eq(watermarks.boardId, boardId),
          ),
        )
        .get()
      return row?.lastSeenPostId ?? null
    },
    set(automationId, cafeId, boardId, lastSeenPostId, updatedAt) {
      db.insert(watermarks)
        .values({ automationId, cafeId, boardId, lastSeenPostId, updatedAt })
        .onConflictDoUpdate({
          target: [watermarks.cafeId, watermarks.automationId, watermarks.boardId],
          set: { lastSeenPostId, updatedAt },
        })
        .run()
    },
  }
}
