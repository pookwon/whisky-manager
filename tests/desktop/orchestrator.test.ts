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
import type { CommentAuthorLookup } from '../../src/desktop/commentAuthors.js'
import { runSession, type SessionDeps, type SessionProgress } from '../../src/desktop/orchestrator.js'
import { firstPostIdByAuthor } from '../../src/shared/screening.js'
import { operatorAlreadyCommentedGuard } from '../../src/shared/guards.js'
import { firstPostOnlyGuard } from '../../src/shared/automations/welcome-comment/firstPost.js'
import { PROFILES } from '../../src/shared/profiles.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { FakeClock, SequenceRandom } from '../fakes.js'
import { KST_OFFSET_MS, kstDayStartMs } from '../../src/shared/kst.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const HOUR = 3_600_000
const DAY = 86_400_000
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)
const TODAY = kstDayStartMs(MON_10_00)
const YESTERDAY = TODAY - DAY

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
          diagnostic: null,
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
    authorId: `m${postId}`,
    postedAt,
    commentCount: 0,
  }
}

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let idCounter = 0

function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  const defaultLookup: CommentAuthorLookup = {
    resolve: async (postId, commentCount) => {
      if (commentCount === null) return null
      if (commentCount === 0) return []
      // Default: return an operator comment (matching the old stopgap behavior
      // where posts with comments were treated as having operator comments)
      return [{ nickname: 'cafe-ops', memberKey: 'key-ops' }]
    },
  }
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    policy: 'AUTO',
    limits: PROFILES.production,
    guards: [operatorAlreadyCommentedGuard, firstPostOnlyGuard],
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
    commentAuthors: defaultLookup,
    runMode: 'SCHEDULED',
    lastSettledDay: () => YESTERDAY,
    onDaySettled: () => {},
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

describe('firstPostIdByAuthor', () => {
  it('returns the earliest post by each author', () => {
    const sameAuthorId = 'author-1'
    const post1: RawCandidate = {
      postId: '1001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: sameAuthorId,
      postedAt: MON_10_00 - 60_000,
      commentCount: 0,
    }
    const post2: RawCandidate = {
      postId: '1002',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: sameAuthorId,
      postedAt: MON_10_00 - 30_000,
      commentCount: 0,
    }
    const result = firstPostIdByAuthor([post1, post2])
    expect(result.get(sameAuthorId)).toBe('1001')
  })

  it('breaks ties on postedAt using comparePostId', () => {
    const sameAuthorId = 'author-1'
    const sameTimestamp = MON_10_00 - 60_000
    const post1: RawCandidate = {
      postId: '2001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: sameAuthorId,
      postedAt: sameTimestamp,
      commentCount: 0,
    }
    const post2: RawCandidate = {
      postId: '1001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: sameAuthorId,
      postedAt: sameTimestamp,
      commentCount: 0,
    }
    const result = firstPostIdByAuthor([post1, post2])
    // When times are identical, lower post ID wins (comparePostId('1001', '2001') < 0)
    expect(result.get(sameAuthorId)).toBe('1001')
  })
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
    })
    expect(db.select().from(executions).all().map((r) => r.status)).toEqual(['SUCCESS', 'SUCCESS'])
  })

  it('paces every execution through the injected sleep', async () => {
    const waits: number[] = []
    const transport = fakeTransport({ candidates: [candidate('1020'), candidate('1021')] })

    await runSession(deps({ transport, sleep: (ms) => { waits.push(ms); return Promise.resolve() } }))

    // Dropping the pacing call would fire both comments back to back. The
    // bound comes from the profile so retuning the cadence cannot quietly
    // turn this into an assertion about a number nobody uses any more.
    expect(waits).toHaveLength(2)
    for (const wait of waits) {
      expect(wait).toBeGreaterThanOrEqual(PROFILES.production.actionIntervalMinMs)
      expect(wait).toBeLessThanOrEqual(PROFILES.production.actionIntervalMaxMs)
    }
  })

  it('stores the risk flags that drove the decision', async () => {
    const unchecked = { ...candidate('1030'), commentCount: null }
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
      commentCount: 1,
    }
    expect(await runSession(deps({ transport: fakeTransport({ candidates: [already] }) }))).toMatchObject({
      opened: true,
      executed: 0,
      skipped: 1,
    })
  })

  it('skips rather than queues when the comment check failed', async () => {
    const unchecked = { ...candidate('1004'), commentCount: null }
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
    const unchecked = { ...candidate('1005'), commentCount: null }
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
  it('stops at the per-session cap and does not leave a row behind', async () => {
    const many = Array.from({ length: 4 }, (_, i) => candidate(`20${i}`))
    const transport = fakeTransport({ candidates: many })
    const limits = { ...PROFILES.production, perSessionCap: 2 }

    expect(await runSession(deps({ transport, limits }))).toMatchObject({ opened: true, executed: 2 })
    // The candidates that hit the cap are never claimed at all and will simply
    // be collected again next session. No row is left behind.
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('does not process candidates when the hour has no room left', async () => {
    const transport = fakeTransport({ candidates: [candidate('3001')] })
    const limits = { ...PROFILES.production, hourlyCap: 0 }

    expect(await runSession(deps({ transport, limits }))).toMatchObject({ opened: true, executed: 0 })
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
    // approval request whose postedAt is older than backlogMaxAgeMs (48h) but
    // whose detectedAt is recent (measured by sweepApprovals, which uses
    // approvalTtlMs). The backlog brake looks at postedAt, not detectedAt.
    const old = { ...candidate('5001', MON_10_00 - 50 * HOUR), commentCount: null }
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

describe('runSession — caps', () => {
  // Small enough to keep the fixtures readable; the point is the cap holding,
  // not the number the profile happens to carry.
  const cap = 15
  const capped = { ...PROFILES.production, perSessionCap: cap }
  const overCap = cap + 5

  it('a scheduled run stops at the per-session cap', async () => {
    const many = Array.from({ length: overCap }, (_, i) => candidate(`${6000 + i}`))
    const transport = fakeTransport({ candidates: many })

    const outcome = await runSession(deps({ transport, limits: capped, runMode: 'SCHEDULED' }))
    expect(outcome).toMatchObject({ opened: true, executed: cap })
  })

  it('a manual run bypasses the per-session cap and processes all within daily limit', async () => {
    const many = Array.from({ length: overCap }, (_, i) => candidate(`${7000 + i}`))
    const transport = fakeTransport({ candidates: many })

    const outcome = await runSession(deps({ transport, limits: capped, runMode: 'MANUAL' }))
    expect(outcome).toMatchObject({ opened: true, executed: overCap })
  })

  it('a manual run still respects the hourly cap', async () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate(`${8000 + i}`))
    const transport = fakeTransport({ candidates: many })
    const limits = { ...PROFILES.production, hourlyCap: 20 }

    const outcome = await runSession(deps({ transport, limits, runMode: 'MANUAL' }))
    expect(outcome).toMatchObject({ opened: true, executed: 20 })
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
    const flagged = { ...candidate('5300'), commentCount: null }
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

describe('runSession — the hourly cap moves with the clock', () => {
  it('lets a later session through once earlier requests leave the window', async () => {
    const clock = new FakeClock(MON_10_00)
    const limits = { ...PROFILES.production, hourlyCap: 1 }
    const send = (postId: string) =>
      runSession(deps({ clock, limits, transport: fakeTransport({ candidates: [candidate(postId)] }) }))

    expect(await send('6400')).toMatchObject({ opened: true, executed: 1 })

    // Same hour: the one slot is spent.
    expect(await send('6401')).toMatchObject({ opened: true, executed: 0 })

    // This is what separates an hourly cap from a daily one — the window slides
    // rather than resetting at some boundary, so the first request stops
    // counting once it is an hour old.
    clock.set(MON_10_00 + 61 * 60_000)
    expect(await send('6402')).toMatchObject({ opened: true, executed: 1 })
  })
})

describe('runSession — caps count attempts, not successes', () => {
  it('counts a failed execution against the hourly cap', async () => {
    // One failure, then a second session with a cap of 1 must refuse to send.
    // The hour does not care whether naver accepted the request, only that it
    // was made.
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('6200')], executeOk: false }) }))

    const limits = { ...PROFILES.production, hourlyCap: 1 }
    const outcome = await runSession(
      deps({ transport: fakeTransport({ candidates: [candidate('6201')] }), limits }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0 })
  })

  it('counts a failed execution against the session cap', async () => {
    const limits = { ...PROFILES.production, perSessionCap: 1 }
    const transport = fakeTransport({ candidates: [candidate('6300'), candidate('6301')], executeOk: false })

    const outcome = await runSession(deps({ transport, limits }))

    // The first attempt used the only slot even though it failed. The second
    // candidate is not claimed at all since the cap check before claim rejects it.
    expect(outcome).toMatchObject({ opened: true, executed: 0, failed: 0 })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(1)
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

describe('runSession — progress', () => {
  it('reports how far along it is and whose post is in hand', async () => {
    const seen: SessionProgress[] = []

    await runSession(
      deps({
        transport: fakeTransport({ candidates: [candidate('1001'), candidate('1002')] }),
        onProgress: (progress) => seen.push(progress),
      }),
    )

    expect(seen).toEqual([
      { phase: 'COLLECTING' },
      { phase: 'WORKING', done: 0, total: 2, nickname: 'nick' },
      { phase: 'WORKING', done: 1, total: 2, nickname: 'nick' },
    ])
  })

  it('counts the backlog and the fresh collection as separate walks', async () => {
    // Park a row so the next session has a backlog to clear before collecting.
    await runSession(
      deps({ transport: fakeTransport({ candidates: [candidate('4300')], executeOk: false }) }),
    )
    const parked = repo.listUnresolved('welcome-comment')[0]
    expect(parked?.status).toBe('RETRY_WAIT')
    repo.applyPatch(parked!.id, { status: 'QUEUED' })

    const seen: SessionProgress[] = []
    await runSession(
      deps({
        transport: fakeTransport({ candidates: [candidate('4400'), candidate('4401')] }),
        onProgress: (progress) => seen.push(progress),
      }),
    )

    // Neither total ever grows under the operator: the backlog is counted
    // against its own length, today's posts against theirs.
    expect(seen).toEqual([
      { phase: 'BACKLOG', done: 0, total: 1, nickname: 'nick' },
      { phase: 'COLLECTING' },
      { phase: 'WORKING', done: 0, total: 2, nickname: 'nick' },
      { phase: 'WORKING', done: 1, total: 2, nickname: 'nick' },
    ])
  })

  it('reports nothing when a gate refuses the session', async () => {
    const seen: SessionProgress[] = []

    await runSession(deps({ isEnabled: () => false, onProgress: (progress) => seen.push(progress) }))

    expect(seen).toEqual([])
  })
})

describe('runSession — Task 1 deferred: re-judge unfinished rows', () => {
  it('revives an unfinished row on the next session', async () => {
    // First session: skips the post (not approved to execute)
    const firstTransport = fakeTransport({ candidates: [candidate('1050')], executeOk: false })
    await runSession(deps({ transport: firstTransport, policy: 'AUTO' }))

    const firstRow = db.select().from(executions).all()[0]
    expect(firstRow?.status).toBe('RETRY_WAIT')

    // Manually reset to SKIPPED to simulate an earlier unfinished state
    repo.applyPatch(firstRow!.id, { status: 'SKIPPED' })

    // Second session: same post is collected again and should be revived
    const secondTransport = fakeTransport({ candidates: [candidate('1050')] })
    const outcome = await runSession(deps({ transport: secondTransport }))

    expect(outcome).toMatchObject({ opened: true, executed: 1, skipped: 0 })
    const finalRow = db.select().from(executions).all()[0]
    expect(finalRow?.id).toBe(firstRow?.id)
    expect(finalRow?.status).toBe('SUCCESS')
  })

  it('records NOT_FIRST_POST reason when the same author has two posts', async () => {
    const sameAuthorId = 'author-shared'
    const earlierPost: RawCandidate = {
      postId: '2001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'shared-nick',
      authorId: sameAuthorId,
      postedAt: MON_10_00 - 60_000,
      commentCount: 0,
    }
    const laterPost: RawCandidate = {
      postId: '2002',
      title: '가입인사',
      bodyText: '또 반갑습니다',
      authorNickname: 'shared-nick',
      authorId: sameAuthorId,
      postedAt: MON_10_00 - 30_000,
      commentCount: 0,
    }

    const transport = fakeTransport({ candidates: [earlierPost, laterPost] })
    const outcome = await runSession(deps({ transport }))

    expect(outcome).toMatchObject({ opened: true, executed: 1, skipped: 1 })

    const rows = db.select().from(executions).all().sort((a, b) => a.targetPostId.localeCompare(b.targetPostId))
    expect(rows).toHaveLength(2)

    const [first, second] = rows
    expect(first?.targetPostId).toBe('2001')
    expect(first?.status).toBe('SUCCESS')

    expect(second?.targetPostId).toBe('2002')
    expect(second?.status).toBe('SKIPPED')
    expect(second?.reason).toBe('NOT_FIRST_POST')
  })
})

describe('runSession — first post detection', () => {
  it('identifies earliest post per author regardless of collection order', async () => {
    const sameAuthorId = 'author-1'
    const post1: RawCandidate = {
      postId: '1001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: sameAuthorId,
      postedAt: MON_10_00 - 60_000,
      commentCount: 0,
    }
    const post2: RawCandidate = {
      postId: '1002',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: sameAuthorId,
      postedAt: MON_10_00 - 30_000,
      commentCount: 0,
    }

    // Test with oldest-first order
    const raws1 = [post1, post2]
    const firstPosts1 = firstPostIdByAuthor(raws1)
    expect(firstPosts1.get(sameAuthorId)).toBe('1001')

    // Test with newest-first order — should still pick the earliest
    const raws2 = [post2, post1]
    const firstPosts2 = firstPostIdByAuthor(raws2)
    expect(firstPosts2.get(sameAuthorId)).toBe('1001')
  })

  it('records AUTHOR_UNKNOWN risk flag for posts with null authorId under AUTO policy', async () => {
    const unknownAuthorPost: RawCandidate = {
      postId: '1001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick',
      authorId: null,
      postedAt: MON_10_00 - 60_000,
      commentCount: 0,
    }
    await runSession(deps({ transport: fakeTransport({ candidates: [unknownAuthorPost] }), policy: 'AUTO' }))

    // AUTO policy routes risk posts to SKIPPED
    const rows = db.select().from(executions).all()
    expect(rows.length).toBeGreaterThan(0)
    const row = rows[0]
    expect(row?.status).toBe('SKIPPED')
    expect(row?.riskFlags).toContain('AUTHOR_UNKNOWN')
  })

  it('does not disturb first-post judgement for other authors when one post has null authorId', async () => {
    const author1Post: RawCandidate = {
      postId: '1001',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick1',
      authorId: 'author-1',
      postedAt: MON_10_00 - 60_000,
      commentCount: 0,
    }
    const unknownAuthorPost: RawCandidate = {
      postId: '1002',
      title: '가입인사',
      bodyText: '반갑습니다',
      authorNickname: 'nick2',
      authorId: null,
      postedAt: MON_10_00 - 45_000,
      commentCount: 0,
    }
    const transport = fakeTransport({ candidates: [author1Post, unknownAuthorPost] })
    const outcome = await runSession(deps({ transport, policy: 'AUTO' }))

    expect(outcome.opened).toBe(true)
    if (!outcome.opened) return
    // author1Post executed, unknownAuthorPost skipped (for RISK)
    expect(outcome.executed).toBeGreaterThanOrEqual(1)
    expect(outcome.skipped).toBeGreaterThanOrEqual(1)
  })
})

describe('runSession — forced runs', () => {
  const NIGHT = Date.UTC(2026, 7, 24, 3, 0, 0)

  it('opens outside the operating window, where a manual run would not', async () => {
    const clock = new FakeClock(NIGHT)

    expect(await runSession(deps({ clock, runMode: 'MANUAL' }))).toEqual({
      opened: false,
      reason: 'OUTSIDE_ACTIVE_HOURS',
    })
    expect(await runSession(deps({ clock, runMode: 'FORCED' }))).toMatchObject({ opened: true })
  })

  it('opens despite a backlog old enough to stop the schedule', async () => {
    // Same shape the brake was built for: an approval a human left sitting.
    // Its postedAt is older than backlogMaxAgeMs (48h), but its detectedAt is
    // recent, so sweepApprovals (which uses approvalTtlMs) has not yet expired it.
    const old = { ...candidate('5001', MON_10_00 - 50 * HOUR), commentCount: null }
    await runSession(deps({ transport: fakeTransport({ candidates: [old] }), policy: 'SEMI' }))
    expect(repo.listUnresolved('welcome-comment')[0]?.status).toBe('AWAITING_APPROVAL')

    expect(await runSession(deps({ runMode: 'SCHEDULED' }))).toEqual({
      opened: false,
      reason: 'STALE_BACKLOG',
    })
    expect(await runSession(deps({ runMode: 'FORCED' }))).toMatchObject({ opened: true })
  })

  it('carries on past the hourly cap', async () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate(`${9100 + i}`))
    const limits = { ...PROFILES.production, hourlyCap: 20 }

    const outcome = await runSession(
      deps({ transport: fakeTransport({ candidates: many }), limits, runMode: 'FORCED' }),
    )
    expect(outcome).toMatchObject({ opened: true, executed: 30 })
  })

  it('still refuses when the kill switch is engaged', async () => {
    expect(await runSession(deps({ runMode: 'FORCED', isKilled: () => true }))).toEqual({
      opened: false,
      reason: 'KILLED',
    })
  })

  it('still refuses when the automation is switched off', async () => {
    expect(await runSession(deps({ runMode: 'FORCED', isEnabled: () => false }))).toEqual({
      opened: false,
      reason: 'DISABLED',
    })
  })

  it('stops within one post of the kill switch being thrown', async () => {
    // The only way back out of a long forced run.
    let killed = false
    const many = Array.from({ length: 10 }, (_, i) => candidate(`${9200 + i}`))

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: many }),
        runMode: 'FORCED',
        isKilled: () => killed,
        sleep: () => {
          killed = true
          return Promise.resolve()
        },
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0 })
  })
})

describe('runSession — a chosen day', () => {
  /** 2026-08-20 00:00 KST, four days before the fixture's "now". */
  const CHOSEN = Date.UTC(2026, 7, 19, 15, 0)
  const DAY = 86_400_000

  function on(dayStartMs: number, hours: number, postId: string, authorId: string) {
    return { ...candidate(postId, dayStartMs + hours * HOUR), authorId }
  }

  it('asks the board for that day, not for today', async () => {
    const sent: AppMessage[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        sent.push(message)
        return fakeTransport().request(message)
      },
    }

    await runSession(deps({ transport, dayStartMs: CHOSEN }))

    const collect = sent.find((m) => m.type === 'COLLECT')
    expect(collect).toMatchObject({ sincePostedAt: CHOSEN })
  })

  it('drops what the board returned from after that day', async () => {
    const transport = fakeTransport({
      candidates: [on(CHOSEN, 10, '7001', 'a1'), on(CHOSEN + DAY, 10, '7002', 'a2')],
    })

    const outcome = await runSession(deps({ transport, dayStartMs: CHOSEN }))

    expect(outcome).toMatchObject({ opened: true, executed: 1 })
    expect(db.select().from(executions).all().map((r) => r.targetPostId)).toEqual(['7001'])
  })

  it('decides the author\'s earliest post after the trim, not before', async () => {
    // One author, two posts: the chosen day's and the next day's. Judging
    // before the trim would make the chosen day's post a later one and skip it,
    // which is the whole reason the order matters.
    const transport = fakeTransport({
      candidates: [on(CHOSEN, 10, '7101', 'same'), on(CHOSEN + DAY, 10, '7102', 'same')],
    })

    const outcome = await runSession(deps({ transport, dayStartMs: CHOSEN }))

    expect(outcome).toMatchObject({ opened: true, executed: 1, skipped: 0 })
    const rows = db.select().from(executions).all()
    expect(rows.map((r) => r.targetPostId)).toEqual(['7101'])
    expect(rows[0]?.status).toBe('SUCCESS')
  })

  it('works today when no day is given', async () => {
    const sent: AppMessage[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        sent.push(message)
        return fakeTransport().request(message)
      },
    }

    await runSession(deps({ transport }))

    const collect = sent.find((m) => m.type === 'COLLECT')
    expect(collect).toMatchObject({ sincePostedAt: kstDayStartMs(MON_10_00) })
  })
})

describe('runSession — comment author resolution', () => {
  function fakeLookup(options: { responses?: Record<string, CommentAuthor[] | null> } = {}) {
    const checked = new Set<string>()
    return {
      checked,
      lookup: {
        resolve: async (postId: string, commentCount: number | null) => {
          if (commentCount === null) return null
          if (commentCount === 0) return []
          checked.add(postId)
          return options.responses?.[postId] ?? null
        },
      },
    }
  }

  it('resolves existing comments and judges based on who commented', async () => {
    // Post with an operator comment should be skipped
    const withOperator = { ...candidate('8001'), commentCount: 2 }
    // Post with only member comments should be executed
    const withoutOperator = { ...candidate('8002'), commentCount: 3 }

    const lookup = fakeLookup({
      responses: {
        '8001': [{ nickname: 'cafe-ops', memberKey: 'key-ops' }],
        '8002': [{ nickname: 'member1', memberKey: 'key1' }],
      },
    })

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: [withOperator, withoutOperator] }),
        commentAuthors: lookup.lookup,
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 1, skipped: 1 })
    expect(lookup.checked).toContain('8001')
    expect(lookup.checked).toContain('8002')
  })

  it('does not check posts with zero comments', async () => {
    const zeroComments = { ...candidate('8010'), commentCount: 0 }

    const lookup = fakeLookup()

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: [zeroComments] }),
        commentAuthors: lookup.lookup,
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 1 })
    expect(lookup.checked).not.toContain('8010')
  })

  it('skips posts where the comment count is unreadable and marks COMMENT_CHECK_FAILED', async () => {
    const nullCount = { ...candidate('8020'), commentCount: null }

    const lookup = fakeLookup()

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: [nullCount] }),
        commentAuthors: lookup.lookup,
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1 })
    expect(lookup.checked).not.toContain('8020')
    const rows = db.select().from(executions).all()
    expect(rows[0]?.riskFlags).toContain('COMMENT_CHECK_FAILED')
  })

  it('skips and flags when the lookup returns null (check failed)', async () => {
    const withComments = { ...candidate('8030'), commentCount: 2 }

    const lookup = fakeLookup({
      responses: { '8030': null }, // Lookup failed
    })

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: [withComments] }),
        commentAuthors: lookup.lookup,
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1 })
    expect(lookup.checked).toContain('8030')
    const rows = db.select().from(executions).all()
    expect(rows[0]?.riskFlags).toContain('COMMENT_CHECK_FAILED')
  })

  it('does not check posts past the session cap', async () => {
    const cap = 2
    const capped = { ...PROFILES.production, perSessionCap: cap }
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...candidate(`80${40 + i}`),
      commentCount: 1,
    }))

    // Return member comments (no operator) so posts can be executed
    const lookup = fakeLookup({
      responses: {
        '8040': [{ nickname: 'member1', memberKey: 'key1' }],
        '8041': [{ nickname: 'member2', memberKey: 'key2' }],
        '8042': [{ nickname: 'member3', memberKey: 'key3' }],
        '8043': [{ nickname: 'member4', memberKey: 'key4' }],
        '8044': [{ nickname: 'member5', memberKey: 'key5' }],
      },
    })

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: many }),
        limits: capped,
        runMode: 'SCHEDULED',
        commentAuthors: lookup.lookup,
      }),
    )

    expect(outcome).toMatchObject({ opened: true, executed: cap })
    // Only the first `cap` posts should be checked
    expect(lookup.checked).toContain('8040')
    expect(lookup.checked).toContain('8041')
    // Posts past the cap should NOT be checked
    expect(lookup.checked).not.toContain('8042')
    expect(lookup.checked).not.toContain('8043')
    expect(lookup.checked).not.toContain('8044')

    // No lingering QUEUED row from hitting the cap
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('leaves nothing behind when a cap stops the walk', async () => {
    const cap = 1
    const capped = { ...PROFILES.production, perSessionCap: cap, hourlyCap: 1 }
    const many = Array.from({ length: 3 }, (_, i) => ({
      ...candidate(`80${50 + i}`),
      commentCount: 1,
    }))

    // Return member comments (no operator) so posts can be executed
    const lookup = fakeLookup({
      responses: {
        '8050': [{ nickname: 'member1', memberKey: 'key1' }],
        '8051': [{ nickname: 'member2', memberKey: 'key2' }],
        '8052': [{ nickname: 'member3', memberKey: 'key3' }],
      },
    })

    const outcome = await runSession(
      deps({
        transport: fakeTransport({ candidates: many }),
        limits: capped,
        runMode: 'SCHEDULED',
        commentAuthors: lookup.lookup,
      }),
    )

    // First session: one executes, others are not checked and leave no row
    expect(outcome).toMatchObject({ opened: true, executed: 1 })
    expect(lookup.checked).toContain('8050')
    expect(lookup.checked).not.toContain('8051')
    expect(lookup.checked).not.toContain('8052')
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })
})

describe('settling the previous day', () => {
  /** Records the floor each COLLECT asked for, in the order they were asked. */
  function collectingTransport(byFloor: Map<number, RawCandidate[]>, asked: number[]) {
    const base = fakeTransport()
    return {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'COLLECT') {
          asked.push(message.sincePostedAt)
          return Promise.resolve({
            type: 'COLLECTED',
            requestId: message.requestId,
            candidates: byFloor.get(message.sincePostedAt) ?? [],
          })
        }
        return base.request(message)
      },
    }
  }

  it('works yesterday before today when yesterday is unsettled', async () => {
    const asked: number[] = []
    const transport = collectingTransport(
      new Map([
        [YESTERDAY, [candidate('9001', YESTERDAY + 23 * HOUR + 55 * 60_000)]],
        [TODAY, [candidate('9002', MON_10_00 - 60_000)]],
      ]),
      asked,
    )

    const outcome = await runSession(deps({ transport, lastSettledDay: () => null }))

    expect(asked).toEqual([YESTERDAY, TODAY])
    expect(outcome).toMatchObject({ opened: true, executed: 2 })
  })

  it('collects once when yesterday is already settled', async () => {
    const asked: number[] = []
    const transport = collectingTransport(new Map([[TODAY, [candidate('9002')]]]), asked)

    await runSession(deps({ transport, lastSettledDay: () => YESTERDAY }))

    expect(asked).toEqual([TODAY])
  })

  it('records the day it settled', async () => {
    const settled: number[] = []
    const transport = collectingTransport(new Map(), [])

    await runSession(
      deps({ transport, lastSettledDay: () => null, onDaySettled: (d) => settled.push(d) }),
    )

    expect(settled).toEqual([YESTERDAY])
  })

  it('does not record a day whose collection failed', async () => {
    // A failed read is not an empty day. Recording it would retire a day nobody
    // ever looked at.
    const settled: number[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'COLLECT') {
          return Promise.resolve({ type: 'ERROR', requestId: message.requestId, code: 'COLLECT_FAILED', message: 'collection failed' })
        }
        return fakeTransport().request(message)
      },
    }

    await runSession(
      deps({ transport, lastSettledDay: () => null, onDaySettled: (d) => settled.push(d) }),
    )

    expect(settled).toEqual([])
  })

  it('works today even when settling yesterday failed', async () => {
    let first = true
    const asked: number[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'COLLECT') {
          asked.push(message.sincePostedAt)
          if (first) {
            first = false
            return Promise.resolve({ type: 'ERROR', requestId: message.requestId, code: 'COLLECT_FAILED', message: 'collection failed' })
          }
          return Promise.resolve({
            type: 'COLLECTED',
            requestId: message.requestId,
            candidates: [candidate('9002')],
          })
        }
        return fakeTransport().request(message)
      },
    }

    const outcome = await runSession(deps({ transport, lastSettledDay: () => null }))

    expect(asked).toEqual([YESTERDAY, TODAY])
    expect(outcome).toMatchObject({ opened: true, executed: 1 })
  })

  it('judges each day on its own set', async () => {
    // The same person wrote last thing yesterday and again today. Each post is
    // the earliest that person made in its own day, so each is answered — which
    // is the whole reason the two days are collected separately rather than as
    // one widened window.
    const asked: number[] = []
    const yesterdayPost: RawCandidate = {
      ...candidate('9001', YESTERDAY + 23 * HOUR + 55 * 60_000),
      authorId: 'same-person',
    }
    const todayPost: RawCandidate = {
      ...candidate('9002', MON_10_00 - 60_000),
      authorId: 'same-person',
    }
    const transport = collectingTransport(
      new Map([
        [YESTERDAY, [yesterdayPost]],
        [TODAY, [todayPost]],
      ]),
      asked,
    )

    const outcome = await runSession(deps({ transport, lastSettledDay: () => null }))

    expect(outcome).toMatchObject({ opened: true, executed: 2, skipped: 0 })
  })

  it('costs nothing to walk a day that is already answered', async () => {
    // What makes re-walking a settled day cheap: a finished row is terminal, so
    // the claim turns it away before anything asks the cafe about it.
    const post = candidate('9001', YESTERDAY + 23 * HOUR)
    const transport = collectingTransport(new Map([[YESTERDAY, [post]]]), [])

    await runSession(deps({ transport, lastSettledDay: () => null }))
    const afterFirst = db.select().from(executions).all()
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]?.status).toBe('SUCCESS')

    let asked = 0
    const counting: CommentAuthorLookup = {
      resolve: async () => {
        asked += 1
        return []
      },
    }
    await runSession(
      deps({ transport, lastSettledDay: () => null, commentAuthors: counting }),
    )

    expect(asked).toBe(0)
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('settles only yesterday, never the day before it', async () => {
    const asked: number[] = []
    const transport = collectingTransport(new Map(), asked)

    await runSession(deps({ transport, lastSettledDay: () => YESTERDAY - 5 * DAY }))

    expect(asked).toEqual([YESTERDAY, TODAY])
  })

  it('works only yesterday in settle mode', async () => {
    // The run that fires a few minutes past midnight has nothing to do with the
    // day that is five minutes old. Greeting on an empty board is what the
    // operating window exists to prevent.
    const asked: number[] = []
    const transport = collectingTransport(new Map(), asked)
    const justAfterMidnight = TODAY + 5 * 60_000

    await runSession(
      deps({
        transport,
        runMode: 'SETTLE',
        clock: new FakeClock(justAfterMidnight, KST_OFFSET_MS),
        lastSettledDay: () => null,
      }),
    )

    expect(asked).toEqual([YESTERDAY])
  })

  it('opens outside the operating window in settle mode', async () => {
    const justAfterMidnight = TODAY + 5 * 60_000
    const outcome = await runSession(
      deps({
        runMode: 'SETTLE',
        clock: new FakeClock(justAfterMidnight, KST_OFFSET_MS),
        lastSettledDay: () => null,
      }),
    )

    expect(outcome.opened).toBe(true)
  })

  it('still refuses a scheduled session outside the operating window', async () => {
    const justAfterMidnight = TODAY + 5 * 60_000
    const outcome = await runSession(deps({ clock: new FakeClock(justAfterMidnight, KST_OFFSET_MS) }))

    expect(outcome).toEqual({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })
  })

  it('works only the day it was told to when an operator names one', async () => {
    // A dated run is the operator naming a day. Settling must not widen it.
    const asked: number[] = []
    const transport = collectingTransport(new Map(), asked)
    const named = YESTERDAY - 3 * DAY

    await runSession(
      deps({ transport, runMode: 'FORCED', dayStartMs: named, lastSettledDay: () => null }),
    )

    expect(asked).toEqual([named])
  })
})
