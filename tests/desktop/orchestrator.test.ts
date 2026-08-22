import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { executions } from '../../src/desktop/db/schema.js'
import type { CommentAuthor } from '../../src/shared/types.js'
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
  /** Authors returned by the pre-execution re-check. Omitted means none. */
  commentsAtExecution?: CommentAuthor[] | null
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
      if (message.type === 'CHECK_COMMENTS') {
        return Promise.resolve({
          type: 'COMMENTS',
          requestId: message.requestId,
          authors: options.commentsAtExecution === undefined ? [] : options.commentsAtExecution,
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
    renderBody: (c) =>
      c.authorNickname === null
        ? { ok: false, missing: ['닉네임'] }
        : { ok: true, templateId: 'tpl-1', body: `${c.authorNickname}님 환영합니다` },
    isEnabled: () => true,
    hasTemplate: () => true,
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
  it('executes clean candidates and records every outcome field', async () => {
    const transport = fakeTransport({ candidates: [candidate('1001'), candidate('1002')] })
    const outcome = await runSession(deps({ transport }))

    // toEqual, not toMatchObject: a dropped counter should fail this test.
    expect(outcome).toEqual({
      opened: true,
      executed: 2,
      skipped: 0,
      awaitingApproval: 0,
      failed: 0,
      expired: 0,
      lastProcessedPostId: '1002',
    })
    expect(db.select().from(executions).all().map((r) => r.status)).toEqual(['SUCCESS', 'SUCCESS'])
  })

  it('paces every execution through the injected sleep', async () => {
    const waits: number[] = []
    const transport = fakeTransport({ candidates: [candidate('1020'), candidate('1021')] })

    await runSession(deps({ transport, sleep: (ms) => { waits.push(ms); return Promise.resolve() } }))

    // Dropping the pacing call would fire both comments back to back.
    expect(waits).toEqual([10_000, 10_000])
  })

  it('stores the risk flags that drove the decision', async () => {
    const unchecked = { ...candidate('1030'), existingCommentAuthors: null }
    await runSession(deps({ transport: fakeTransport({ candidates: [unchecked] }), policy: 'SEMI' }))

    expect(db.select().from(executions).all()[0]?.riskFlags).toBe('["COMMENT_CHECK_FAILED"]')
  })

  it('records the execution timestamp separately from resolution', async () => {
    const transport = fakeTransport({ candidates: [candidate('1010')] })
    await runSession(deps({ transport }))

    const rows = db.select().from(executions).all()
    expect(rows[0]?.executedAt).toBe(MON_10_00)
  })

  it('skips a post an operator already greeted', async () => {
    const already = {
      ...candidate('1003'),
      existingCommentAuthors: [{ nickname: 'cafe-ops', memberKey: 'key-ops' }],
    }
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

  it('does not open when an approval request has gone stale', async () => {
    // A retry that ages out is retired by the sweep, so the brake never sees it.
    // What the brake is actually for is work a human has left sitting: an
    // approval request older than the backlog limit but younger than its TTL.
    const old = { ...candidate('5001', MON_10_00 - 30 * HOUR), existingCommentAuthors: null }
    await runSession(deps({ transport: fakeTransport({ candidates: [old] }), policy: 'SEMI' }))
    expect(repo.listUnresolved('welcome-comment')[0]?.status).toBe('AWAITING_APPROVAL')

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

describe('runSession — pre-execution re-check', () => {
  it('skips when an operator commented between collection and execution', async () => {
    // Collection saw no comments, but a staff member got there first.
    const transport = fakeTransport({ candidates: [candidate('7001')], commentsAtExecution: [{ nickname: 'cafe-ops', memberKey: 'key-ops' }] })

    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 0, skipped: 1 })

    const rows = db.select().from(executions).all()
    expect(rows[0]?.status).toBe('SKIPPED')
    expect(rows[0]?.reason).toBe('ALREADY_COMMENTED')
  })

  it('executes when the re-check finds no operator comment', async () => {
    const transport = fakeTransport({ candidates: [candidate('7002')], commentsAtExecution: [] })
    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 1, skipped: 0 })
  })

  it('does not execute when the re-check itself fails', async () => {
    // Posting without knowing is worse than not posting.
    const transport = fakeTransport({ candidates: [candidate('7003')], commentsAtExecution: null })

    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 0, skipped: 1 })

    const rows = db.select().from(executions).all()
    expect(rows[0]?.reason).toBe('COMMENT_CHECK_FAILED')
  })
})

describe('runSession — watermark', () => {
  it('reports the furthest post it finished handling', async () => {
    const transport = fakeTransport({ candidates: [candidate('8001'), candidate('8003'), candidate('8002')] })
    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, lastProcessedPostId: '8003' })
  })

  it('reports null when nothing was collected', async () => {
    expect(await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))).toMatchObject({
      opened: true,
      lastProcessedPostId: null,
    })
  })

  it('does not advance past the candidate that hit the session cap', async () => {
    const many = [candidate('9001'), candidate('9002'), candidate('9003')]
    const limits = { ...PROFILES.production, perSessionCap: 1 }
    const transport = fakeTransport({ candidates: many })

    // 9001 executes, 9002 is claimed then parked by the cap, 9003 is untouched.
    expect(await runSession(deps({ transport, limits }))).toMatchObject({ lastProcessedPostId: '9002' })
  })
})

describe('runSession — queued backlog', () => {
  async function parkOne(postId: string): Promise<string> {
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate(postId)], executeOk: false }) }))
    const parked = repo.listUnresolved('welcome-comment')[0]
    expect(parked?.status).toBe('RETRY_WAIT')
    repo.applyPatch(parked!.id, { status: 'QUEUED' })
    return parked!.id
  }

  it('executes a previously queued row before collecting anything new', async () => {
    await parkOne('4100')

    expect(await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))).toMatchObject({
      opened: true,
      executed: 1,
    })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('resends the same text rather than re-rendering', async () => {
    const id = await parkOne('4200')

    await runSession(
      deps({
        transport: fakeTransport({ candidates: [] }),
        // A different renderer would produce different text if it were consulted.
        renderBody: () => ({ ok: true as const, templateId: 'tpl-2', body: 'DIFFERENT' }),
      }),
    )

    expect(repo.getById(id)?.status).toBe('SUCCESS')
    expect(db.select().from(executions).all()[0]?.renderedText).toBe('nick님 환영합니다')
  })

  it('counts a queued row against the session cap', async () => {
    await parkOne('4300')

    const limits = { ...PROFILES.production, perSessionCap: 1 }
    expect(
      await runSession(deps({ transport: fakeTransport({ candidates: [candidate('4301')] }), limits })),
    ).toMatchObject({ opened: true, executed: 1 })
  })
})

describe('runSession — maintenance runs before the brake', () => {
  it('promotes a fresh retry so the backlog actually drains', async () => {
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('5100')], executeOk: false }) }))
    expect(repo.listUnresolved('welcome-comment')[0]?.status).toBe('RETRY_WAIT')

    // No manual promotion this time: the session must do it itself.
    expect(await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))).toMatchObject({
      opened: true,
      executed: 1,
    })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('expires a stale retry instead of letting it block every future session', async () => {
    const old = MON_10_00 - 30 * HOUR
    await runSession(
      deps({ transport: fakeTransport({ candidates: [candidate('5200', old)], executeOk: false }) }),
    )
    expect(repo.listUnresolved('welcome-comment')[0]?.status).toBe('RETRY_WAIT')

    // Sweeping before the brake is what keeps this from deadlocking forever.
    const outcome = await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))
    expect(outcome).toMatchObject({ opened: true })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('expires an approval request that outlived its ttl', async () => {
    const flagged = { ...candidate('5300'), existingCommentAuthors: null }
    await runSession(deps({ transport: fakeTransport({ candidates: [flagged] }), policy: 'SEMI' }))
    expect(repo.listUnresolved('welcome-comment')[0]?.status).toBe('AWAITING_APPROVAL')

    const muchLater = new FakeClock(MON_10_00 + 60 * HOUR)
    await runSession(deps({ clock: muchLater, transport: fakeTransport({ candidates: [] }) }))

    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })
})

describe('runSession — kill switch during the pacing wait', () => {
  it('does not execute a job killed while it was waiting', async () => {
    let killed = false
    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: [candidate('6100')] }),
        // The operator hits the tray while the session is sleeping.
        sleep: () => {
          killed = true
          return Promise.resolve()
        },
        isKilled: () => killed,
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0 })
    const rows = db.select().from(executions).all()
    expect(rows[0]?.status).toBe('CANCELLED')
  })
})

describe('runSession — caps count attempts, not successes', () => {
  it('counts a failed execution against the daily cap', async () => {
    // One failure, then a second session with a cap of 1 must refuse to send.
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('6200')], executeOk: false }) }))

    const limits = { ...PROFILES.production, dailyCap: 1 }
    const outcome = await runSession(
      deps({ transport: fakeTransport({ candidates: [candidate('6201')] }), limits }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0 })
  })

  it('counts a failed execution against the session cap', async () => {
    const limits = { ...PROFILES.production, perSessionCap: 1 }
    const transport = fakeTransport({ candidates: [candidate('6300'), candidate('6301')], executeOk: false })

    const outcome = await runSession(deps({ transport, limits }))

    // The first attempt used the only slot even though it failed.
    expect(outcome).toMatchObject({ opened: true, executed: 0, failed: 0 })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(2)
  })
})

describe('runSession — configuration gates', () => {
  it('does not open while the automation is disabled', async () => {
    expect(await runSession(deps({ isEnabled: () => false }))).toEqual({ opened: false, reason: 'DISABLED' })
  })

  it('does not open when no template is registered', async () => {
    // Silently skipping every candidate would look like the tool is broken.
    expect(await runSession(deps({ hasTemplate: () => false }))).toEqual({
      opened: false,
      reason: 'NO_TEMPLATE',
    })
  })
})

describe('runSession — render failure feeds the policy', () => {
  const nameless = (postId: string): RawCandidate => ({ ...candidate(postId), authorNickname: null })

  it('skips under AUTO when a variable cannot be substituted', async () => {
    const outcome = await runSession(deps({ transport: fakeTransport({ candidates: [nameless('9100')] }) }))

    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1 })
    const rows = db.select().from(executions).all()
    expect(rows[0]?.reason).toBe('RISK_FLAGGED')
    expect(rows[0]?.riskFlags).toBe('["VARIABLE_EXTRACTION_FAILED"]')
  })

  it('routes the same candidate to approval under SEMI', async () => {
    const outcome = await runSession(
      deps({ transport: fakeTransport({ candidates: [nameless('9101')] }), policy: 'SEMI' }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0, awaitingApproval: 1 })
    expect(db.select().from(executions).all()[0]?.riskFlags).toBe('["VARIABLE_EXTRACTION_FAILED"]')
  })
})
