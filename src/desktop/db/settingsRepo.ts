import { eq } from 'drizzle-orm'
import type { AppDatabase } from './client.js'
import { appSettings } from './schema.js'

export interface SettingsRepo {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
}

export function createSettingsRepo(db: AppDatabase): SettingsRepo {
  return {
    get(key) {
      return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value
    },
    set(key, value) {
      db.insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run()
    },
    remove(key) {
      db.delete(appSettings).where(eq(appSettings.key, key)).run()
    },
  }
}
