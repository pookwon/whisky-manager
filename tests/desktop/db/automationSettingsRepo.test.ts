import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationSettingsRepo } from '../../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-automation-settings-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('automationSettingsRepo boardId', () => {
  it('round-trips a board id', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'AUTO',
      limits: {},
      enabled: true,
      boardId: '5',
    })

    expect(repo.get('welcome-comment')?.boardId).toBe('5')
  })

  it('returns null when the board id was never set', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: null,
    })

    expect(repo.get('welcome-comment')?.boardId).toBeNull()
  })

  it('updates the board id without disturbing policy or enabled', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'MANUAL',
      limits: {},
      enabled: true,
      boardId: '5',
    })
    const current = repo.get('welcome-comment')
    if (current === undefined) throw new Error('seed failed')
    repo.upsert({ ...current, boardId: '9' })

    const after = repo.get('welcome-comment')
    expect(after?.boardId).toBe('9')
    expect(after?.policy).toBe('MANUAL')
    expect(after?.enabled).toBe(true)
  })
})
