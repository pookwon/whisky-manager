import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationSettingsRepo } from '../../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createSettingsRepo } from '../../../src/desktop/db/settingsRepo.js'
import { createTemplatesRepo } from '../../../src/desktop/db/templatesRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-repos-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('settingsRepo', () => {
  it('returns undefined for an unknown key', () => {
    expect(createSettingsRepo(db).get('nope')).toBeUndefined()
  })

  it('round-trips a value', () => {
    const repo = createSettingsRepo(db)
    repo.set('pairingToken', 'abc')
    expect(repo.get('pairingToken')).toBe('abc')
  })

  it('overwrites an existing key rather than failing', () => {
    const repo = createSettingsRepo(db)
    repo.set('profile', 'production')
    repo.set('profile', 'debug')
    expect(repo.get('profile')).toBe('debug')
  })
})

describe('templatesRepo', () => {
  it('lists only enabled templates for the automation', () => {
    const repo = createTemplatesRepo(db)
    repo.add({ id: 't1', automationId: 'welcome-comment', body: 'a', createdAt: 1 })
    repo.add({ id: 't2', automationId: 'welcome-comment', body: 'b', createdAt: 2 })
    repo.add({ id: 't3', automationId: 'other', body: 'c', createdAt: 3 })
    repo.setEnabled('t2', false)

    expect(repo.listEnabled('welcome-comment')).toEqual([{ id: 't1', body: 'a' }])
  })

  it('removes a template', () => {
    const repo = createTemplatesRepo(db)
    repo.add({ id: 't1', automationId: 'welcome-comment', body: 'a', createdAt: 1 })
    repo.remove('t1')
    expect(repo.listEnabled('welcome-comment')).toEqual([])
  })
})

describe('automationSettingsRepo', () => {
  it('returns undefined before anything is stored', () => {
    expect(createAutomationSettingsRepo(db).get('welcome-comment')).toBeUndefined()
  })

  it('round-trips policy, limit overrides and the enabled flag', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'SEMI',
      limits: { dailyCap: 50 },
      enabled: false,
      boardId: null,
    })

    expect(repo.get('welcome-comment')).toEqual({
      automationId: 'welcome-comment',
      policy: 'SEMI',
      limits: { dailyCap: 50 },
      enabled: false,
      boardId: null,
    })
  })

  it('overwrites on a second upsert', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'MANUAL',
      limits: {},
      enabled: true,
      boardId: null,
    })
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'AUTO',
      limits: {},
      enabled: true,
      boardId: null,
    })
    expect(repo.get('welcome-comment')?.policy).toBe('AUTO')
  })
})

