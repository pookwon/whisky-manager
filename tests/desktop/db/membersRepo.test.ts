import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createMembersRepo, type MembersRepo } from '../../../src/desktop/db/membersRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const CAFE = '10000000'

let dir: string
let db: AppDatabase
let repo: MembersRepo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-members-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createMembersRepo(db)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createMembersRepo', () => {
  it('reports an empty table so the first run can stop after one page', () => {
    expect(repo.isEmpty(CAFE)).toBe(true)
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.isEmpty(CAFE)).toBe(false)
  })

  it('returns the join date it stored, and null for a member it never saw', () => {
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.joinDateOf(CAFE, 'm1')).toBe('2026.08.23.')
    expect(repo.joinDateOf(CAFE, 'm2')).toBeNull()
  })

  it('keeps cafes apart', () => {
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.joinDateOf('99999', 'm1')).toBeNull()
    expect(repo.isEmpty('99999')).toBe(true)
  })

  it('upserts the same member twice without failing', () => {
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    repo.upsertMany(CAFE, [{ memberKey: 'm1', joinDate: '2026.08.23.' }])
    expect(repo.joinDateOf(CAFE, 'm1')).toBe('2026.08.23.')
  })

  it('accepts an empty batch', () => {
    expect(() => repo.upsertMany(CAFE, [])).not.toThrow()
    expect(repo.isEmpty(CAFE)).toBe(true)
  })

  it('prunes members who joined before the cutoff and keeps the cutoff itself', () => {
    repo.upsertMany(CAFE, [
      { memberKey: 'old', joinDate: '2026.08.10.' },
      { memberKey: 'edge', joinDate: '2026.08.15.' },
      { memberKey: 'fresh', joinDate: '2026.08.23.' },
    ])
    repo.prune(CAFE, '2026.08.15.')
    expect(repo.joinDateOf(CAFE, 'old')).toBeNull()
    expect(repo.joinDateOf(CAFE, 'edge')).toBe('2026.08.15.')
    expect(repo.joinDateOf(CAFE, 'fresh')).toBe('2026.08.23.')
  })
})
