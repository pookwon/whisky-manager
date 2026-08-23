import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationSettingsRepo } from '../../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase } from '../../../src/desktop/db/client.js'
import { createSettingsRepo } from '../../../src/desktop/db/settingsRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const AUTOMATION_ID = 'welcome-comment'

let dir: string

/**
 * A migrations folder holding only the first migration, so a database can be
 * built in its pre-boardId shape and then carried across 0001 for real. Testing
 * the backfill any other way would only test a re-implementation of it.
 */
function migrationsUpToFirst(): string {
  const folder = join(dir, 'drizzle-0000')
  cpSync(MIGRATIONS, folder, { recursive: true })

  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number }[]
  }
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx === 0) }),
  )
  return folder
}

/** Seeds a database at the pre-boardId schema and returns its file path. */
function seedBeforeMigration(globalBoardId: string | null): string {
  const dbPath = join(dir, `${globalBoardId ?? 'none'}.db`)
  const old = openDatabase(dbPath, { migrationsFolder: migrationsUpToFirst() })

  if (globalBoardId !== null) createSettingsRepo(old).set('boardId', globalBoardId)
  // Written through raw SQL: the repo now requires a boardId that the old
  // schema has no column for.
  old.run(
    sql`INSERT INTO automation_settings (automation_id, policy, limits_json, enabled)
        VALUES (${AUTOMATION_ID}, 'SEMI', '{}', 1)`,
  )

  return dbPath
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-board-backfill-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('board_id backfill', () => {
  it('carries the global board setting onto the existing automation', () => {
    const dbPath = seedBeforeMigration('77')

    const db = openDatabase(dbPath, { migrationsFolder: MIGRATIONS })

    expect(createAutomationSettingsRepo(db).get(AUTOMATION_ID)?.boardId).toBe('77')
  })

  it('falls back to the default board when nothing was configured globally', () => {
    const dbPath = seedBeforeMigration(null)

    const db = openDatabase(dbPath, { migrationsFolder: MIGRATIONS })

    expect(createAutomationSettingsRepo(db).get(AUTOMATION_ID)?.boardId).toBe('5')
  })

  it('leaves the global key in place so a rollback still finds it', () => {
    const dbPath = seedBeforeMigration('77')

    const db = openDatabase(dbPath, { migrationsFolder: MIGRATIONS })

    expect(createSettingsRepo(db).get('boardId')).toBe('77')
  })

  it('does not disturb the policy or enabled flag it migrates past', () => {
    const dbPath = seedBeforeMigration('77')

    const db = openDatabase(dbPath, { migrationsFolder: MIGRATIONS })

    const setting = createAutomationSettingsRepo(db).get(AUTOMATION_ID)
    expect(setting?.policy).toBe('SEMI')
    expect(setting?.enabled).toBe(true)
  })
})
