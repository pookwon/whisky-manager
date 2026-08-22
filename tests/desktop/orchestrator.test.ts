import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { executions } from '../../src/desktop/db/schema.js'
import { runSession, type SessionDeps } from '../../src/desktop/orchestrator.js'
import { operatorAlreadyCommentedGuard } from '../../src/shared/guards.js'
import { PROFILES } from '../../src/shared/profiles.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const HOUR = 3_600_000
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

interface FakeTransportOptions {
  loggedIn?: boolean
  candidates?: RawCandidate[]
  executeOk?: boolean
}

function fakeTransport(options: FakeTransportOptions = {}) {
  return {
    isConnected: () => true,
    request(message: AppMessage): Promise<ExtensionMessage> {
      if (message.type === 'CHECK_LOGIN') {
        return Promise.resolve({
          type: 'LOGIN_STATE',
          requestId: message.requestId,
          loggedIn: options.loggedIn ?? true,
          account: 'cafe-ops',
        })
      }
      if (message.type === 'COLLECT') {
        return Promise.resolve({
          type: 'COLLECTED',
          requestId: message.requestId,
          candidates: options.candidates ?? [],
        })
      }
      if (message.type === 'EXECUTE') {
        const ok = options.executeOk ?? true
        return Promise.resolve({
          type: 'EXECUTED',
          requestId: message.requestId,
          ok,
          strategy: ok ? 'FETCH' : null,
          commentAuthors: [],
          error: ok ? null : 'boom',
        })
      }
      return Promise.reject(new Error(`unexpected message ${message.type}`))
    },
  }
}

function candidate(postId: string, postedAt = MON_10_00 - 60_000): RawCandidate {
  return {
    postId,
    title: '가입인사',
    bodyText: '반갑습니다',
    authorNickname: 'nick',
    authorId: 'm1',
    postedAt,
    existingCommentAuthors: [],
  }
}

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let idCounter = 0

function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    policy: 'AUTO',
    limits: PROFILES.production,
    guards: [operatorAlreadyCommentedGuard],
    operatorAccounts: ['cafe-ops'],
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([10_000]),
    transport: fakeTransport(),
    dedupe: createSqliteDedupeStore(db, () => `exec-${++idCounter}`),
    repo,
    renderBody: (c) => ({ templateId: 'tpl-1', body: `${c.authorNickname ?? ''}님 환영합니다` }),
    isKilled: () => false,
    sleep: () => Promise.resolve(),
    newRequestId: () => `req-${++idCounter}`,
    watermark: null,
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-orch-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  idCounter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runSession — gates before opening', () => {
  it('does not open when the kill switch is engaged', async () => {
    expect(await runSession(deps({ isKilled: () => true }))).toEqual({ opened: false, reason: 'KILLED' })
  })

  it('does not open outside the operating window', async () => {
    const clock = new FakeClock(Date.UTC(2026, 7, 24, 3, 0, 0))
    expect(await runSession(deps({ clock }))).toEqual({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })
  })

  it('does not open when the operator is logged out', async () => {
    expect(await runSession(deps({ transport: fakeTransport({ loggedIn: false }) }))).toEqual({
      opened: false,
      reason: 'NOT_LOGGED_IN',
    })
  })

  it('does not open when the login check itself fails', async () => {
    const transport = { isConnected: () => true, request: () => Promise.reject(new Error('timed out')) }
    expect(await runSession(deps({ transport }))).toEqual({ opened: false, reason: 'LOGIN_CHECK_FAILED' })
  })
})

describe('runSession — AUTO policy', () => {
  it('executes clean candidates and records success', async () => {
    const transport = fakeTransport({ candidates: [candidate('1001'), candidate('1002')] })
    const outcome = await runSession(deps({ transport }))

    expect(outcome).toMatchObject({ opened: true, executed: 2, skipped: 0, awaitingApproval: 0, failed: 0 })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('records the execution timestamp separately from resolution', async () => {
    const transport = fakeTransport({ candidates: [candidate('1010')] })
    await runSession(deps({ transport }))

    const rows = db.select().from(executions).all()
    expect(rows[0]?.executedAt).toBe(MON_10_00)
  })

  it('skips a post an operator already greeted', async () => {
    const already = { ...candidate('1003'), existingCommentAuthors: ['cafe-ops'] }
    expect(await runSession(deps({ transport: fakeTransport({ candidates: [already] }) }))).toMatchObject({
      opened: true,
      executed: 0,
      skipped: 1,
    })
  })

  it('skips rather than queues when the comment check failed', async () => {
    const unchecked = { ...candidate('1004'), existingCommentAuthors: null }
    expect(await runSession(deps({ transport: fakeTransport({ candidates: [unchecked] }) }))).toMatchObject({
      opened: true,
      executed: 0,
      skipped: 1,
      awaitingApproval: 0,
    })
  })
})

describe('runSession — SEMI and MANUAL policies', () => {
  it('queues a flagged candidate for approval under SEMI', async () => {
    const unchecked = { ...candidate('1005'), existingCommentAuthors: null }
    const transport = fakeTransport({ candidates: [unchecked] })

    expect(await runSession(deps({ transport, policy: 'SEMI' }))).toMatchObject({
      opened: true,
      executed: 0,
      awaitingApproval: 1,
    })
  })

  it('queues every candidate for approval under MANUAL', async () => {
    const transport = fakeTransport({ candidates: [candidate('1006')] })

    expect(await runSession(deps({ transport, policy: 'MANUAL' }))).toMatchObject({
      opened: true,
      executed: 0,
      awaitingApproval: 1,
    })
  })
})

describe('runSession — caps and failures', () => {
  it('stops at the per-session cap and leaves the current one queued', async () => {
    const many = Array.from({ length: 4 }, (_, i) => candidate(`20${i}`))
    const transport = fakeTransport({ candidates: many })
    const limits = { ...PROFILES.production, perSessionCap: 2 }

    expect(await runSession(deps({ transport, limits }))).toMatchObject({ opened: true, executed: 2 })
    // The candidate that hit the cap stays QUEUED; the ones after it are never
    // claimed at all and will simply be collected again next session.
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(1)
  })

  it('expires candidates once the daily cap is reached', async () => {
    const transport = fakeTransport({ candidates: [candidate('3001')] })
    const limits = { ...PROFILES.production, dailyCap: 0 }

    expect(await runSession(deps({ transport, limits }))).toMatchObject({ opened: true, executed: 0, expired: 1 })
  })

  it('parks a failed execution in RETRY_WAIT rather than failing outright', async () => {
    const transport = fakeTransport({ candidates: [candidate('4001')], executeOk: false })

    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 0, failed: 0 })

    const unresolved = repo.listUnresolved('welcome-comment')
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.status).toBe('RETRY_WAIT')
    expect(unresolved[0]?.attempts).toBe(1)
  })

  it('does not open when unresolved work has grown stale', async () => {
    const first = fakeTransport({ candidates: [candidate('5001', MON_10_00 - 30 * HOUR)], executeOk: false })
    await runSession(deps({ transport: first }))

    expect(await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))).toEqual({
      opened: false,
      reason: 'STALE_BACKLOG',
    })
  })
})

describe('runSession — dedupe', () => {
  it('ignores a post that was already claimed in an earlier session', async () => {
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('6001')] }) }))

    expect(await runSession(deps({ transport: fakeTransport({ candidates: [candidate('6001')] }) }))).toMatchObject({
      opened: true,
      executed: 0,
      skipped: 0,
    })
  })
})
