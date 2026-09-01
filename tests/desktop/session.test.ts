import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WELCOME_AUTOMATION_ID } from '../../src/desktop/bootstrap.js'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { createAutomationSettingsRepo } from '../../src/desktop/db/automationSettingsRepo.js'
import { createSettingsRepo } from '../../src/desktop/db/settingsRepo.js'
import { createTemplatesRepo } from '../../src/desktop/db/templatesRepo.js'
import { SETTING_KEYS, createSessionRunner } from '../../src/desktop/session.js'
import { executions } from '../../src/desktop/db/schema.js'
import { previewDay } from '../../src/desktop/preview.js'
import { createCommentAuthorLookup } from '../../src/desktop/commentAuthors.js'
import { WELCOME_GUARDS } from '../../src/shared/automations/welcome-comment/guards.js'
import {
  renderAnyWelcomeComment,
  renderWelcomeComment,
} from '../../src/shared/automations/welcome-comment/render.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import type { RenderOutcome } from '../../src/shared/templates.js'
import type { Candidate } from '../../src/shared/types.js'
import { FakeClock, SequenceRandom } from '../fakes.js'
import { kstDayStartMs } from '../../src/shared/kst.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)
const CAFE = 'cafe-under-test'
const BOARD = 'board-under-test'

function candidate(postId: string, nickname: string | null = '신입회원'): RawCandidate {
  return {
    postId,
    title: '가입인사',
    bodyText: nickname ? `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.` : '반갑습니다',
    authorNickname: nickname,
    authorId: 'm1',
    postedAt: MON_10_00 - 60_000,
    commentCount: 0,
  }
}

interface TransportOptions {
  commentsByPostId?: Record<string, import('../../src/shared/types.js').CommentAuthor[] | null>
}

function transportWith(candidates: RawCandidate[], options: TransportOptions = {}) {
  const executed: string[] = []
  /** Which posts were answered, in order, so a count can be held against them. */
  const executedPosts: string[] = []
  /** Every board the session actually asked about, in order. */
  const boards: string[] = []
  const { commentsByPostId = {} } = options
  return {
    executed,
    executedPosts,
    boards,
    transport: {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'CHECK_LOGIN') {
          boards.push(message.source.boardId)
          return Promise.resolve({
            type: 'LOGIN_STATE',
            requestId: message.requestId,
            loggedIn: true,
            account: 'cafe-ops',
          })
        }
        if (message.type === 'COLLECT') {
          return Promise.resolve({ type: 'COLLECTED', requestId: message.requestId, candidates })
        }
        if (message.type === 'CHECK_COMMENTS') {
          // The endpoint fetches the actual comment authors from the thread.
          // Use provided overrides, or default to empty list (no comments).
          const postId = message.action.postId
          const authors: import('../../src/shared/types.js').CommentAuthor[] | null =
            postId in commentsByPostId ? (commentsByPostId[postId] ?? []) : []
          return Promise.resolve({ type: 'COMMENTS', requestId: message.requestId, authors })
        }
        if (message.type === 'EXECUTE') {
          executed.push(message.action.body)
          executedPosts.push(message.action.postId)
          return Promise.resolve({
            type: 'EXECUTED',
            requestId: message.requestId,
            ok: true,
            strategy: 'FETCH',
            commentAuthors: [],
            error: null,
            diagnostic: null,
          })
        }
        return Promise.reject(new Error(`unexpected ${message.type}`))
      },
    },
  }
}

let dir: string
let db: AppDatabase
let counter = 0

function buildWithOptions(candidates: RawCandidate[], options: TransportOptions) {
  const { transport, executed, executedPosts, boards } = transportWith(candidates, options)
  const repos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings: createAutomationSettingsRepo(db),
    dedupe: createSqliteDedupeStore(db, () => `exec-${++counter}`),
  }
  const settings = createSettingsRepo(db)
  // The tool under test is a configured one; the tests that care about an
  // unconfigured one strip this back themselves.
  settings.set(SETTING_KEYS.cafeId, CAFE)
  // One generator for the template draw and the pacing alike, as the app wires it.
  const random = new SequenceRandom([0])
  const renderBody = (target: Candidate): RenderOutcome =>
    renderWelcomeComment(repos.templates.listEnabled(WELCOME_AUTOMATION_ID), random, target)
  const run = createSessionRunner({
    automationId: WELCOME_AUTOMATION_ID,
    profile: 'production',
    clock: new FakeClock(MON_10_00),
    random,
    transport,
    repos,
    settings,
    isKilled: () => false,
    sleep: () => Promise.resolve(),
    newId: () => `req-${++counter}`,
    renderBody,
  })
  return { run, repos, settings, executed, executedPosts, boards, transport }
}

function build(candidates: RawCandidate[]) {
  return buildWithOptions(candidates, {})
}

function enable(repos: ReturnType<typeof build>['repos'], boardId: string | null = BOARD): void {
  repos.automationSettings.upsert({
    automationId: WELCOME_AUTOMATION_ID,
    policy: 'AUTO',
    limits: {},
    enabled: true,
    boardId,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-session-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the count shown before a run, against the run itself', () => {
  /**
   * The panel once offered 148 for a day that produced one comment, because the
   * count and the run worked out their verdicts separately. They now come
   * through one screening, and this holds the two numbers against each other
   * over a day built to reach every branch of it.
   */
  it('promises exactly the comments the run posts', async () => {
    const candidates: RawCandidate[] = [
      // A plain target.
      candidate('2001'),
      // The same author again, later: covered by their first post.
      { ...candidate('2002'), postedAt: MON_10_00 - 30_000 },
      // Nickname unreadable, so the template cannot be filled.
      { ...candidate('2004', null), authorId: 'm4' },
      // Another plain target.
      { ...candidate('2005'), authorId: 'm5' },
      // Already has a comment, but from an ordinary member — still a target.
      // Only the lookup can tell this apart from a staff greeting, so this is
      // the one post that drives both sides down the lookup path.
      { ...candidate('2006'), authorId: 'm6', commentCount: 1 },
    ]

    const { run, repos, settings, executedPosts, transport } = buildWithOptions(candidates, {
      commentsByPostId: { '2006': [{ nickname: 'member9', memberKey: 'key9' }] },
    })
    enable(repos)
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    settings.set(SETTING_KEYS.cafeId, CAFE)

    // The panel resolves commenters the same way the run does, off the same
    // transport, so a post the board list cannot settle is judged rather than
    // shelved. Without it, 2006 would sit in `alreadyHandled` and the count
    // would fall one short of the run.
    const lookup = createCommentAuthorLookup({
      transport,
      cafeId: CAFE,
      boardId: BOARD,
      automationId: WELCOME_AUTOMATION_ID,
      newRequestId: () => `preview-lookup-${++counter}`,
      random: new SequenceRandom([0]),
      sleep: () => Promise.resolve(),
    })

    const preview = await previewDay({
      transport,
      cafeId: CAFE,
      boardId: BOARD,
      automationId: WELCOME_AUTOMATION_ID,
      nowMs: MON_10_00,
      newRequestId: () => `preview-${++counter}`,
      operatorAccounts: [],
      policy: 'AUTO',
      guards: WELCOME_GUARDS,
      renderBody: (target) =>
        renderAnyWelcomeComment(repos.templates.listEnabled(WELCOME_AUTOMATION_ID), target),
      lookup,
    })

    await run()

    expect(preview.kind).toBe('READY')
    if (preview.kind !== 'READY') return
    // Three of the five. The repeat post and the one whose nickname cannot be
    // read are both left alone; the member-commented post is answered, and only
    // the lookup proves it. Named, so a count that happened to match while
    // answering different posts would still fail.
    expect(executedPosts).toEqual(['2001', '2005', '2006'])
    expect(preview.count).toBe(executedPosts.length)
  })
})

describe('createSessionRunner — the day to work', () => {
  const DAY = 86_400_000

  it('refuses a day that has not arrived', async () => {
    const { run, boards } = build([])

    const outcome = await run({ dayStartMs: kstDayStartMs(MON_10_00) + DAY })

    expect(outcome).toEqual({ opened: false, reason: 'FUTURE_DAY' })
    // Refused before anything reached the cafe.
    expect(boards).toEqual([])
  })

  it('accepts today, which is where the boundary sits', async () => {
    const { run, repos, settings } = build([])
    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: true,
      boardId: BOARD,
    })
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    settings.set(SETTING_KEYS.cafeId, CAFE)

    const outcome = await run({ dayStartMs: kstDayStartMs(MON_10_00) })

    expect(outcome).toMatchObject({ opened: true })
  })
})

describe('createSessionRunner', () => {
  it('watches the board recorded on the automation, not the global setting', async () => {
    const { run, repos, settings, boards } = buildWithOptions([], {})
    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: true,
      boardId: '77',
    })
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    settings.set(SETTING_KEYS.cafeId, CAFE)

    await run()

    expect(boards).toEqual(['77'])
  })

  it('refuses rather than guessing a board the automation does not name', async () => {
    const { run, repos, boards } = buildWithOptions([], {})
    enable(repos, null)
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    // No board is not a board to fall back to. A default here would be one
    // cafe's board compiled into every copy of the tool.
    expect(await run()).toEqual({ opened: false, reason: 'NOT_CONFIGURED' })
    expect(boards).toEqual([])
  })

  it('refuses when no cafe has been entered', async () => {
    const { run, repos, settings, boards } = buildWithOptions([], {})
    enable(repos)
    settings.set(SETTING_KEYS.cafeId, '')
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })

    expect(await run()).toEqual({ opened: false, reason: 'NOT_CONFIGURED' })
    expect(boards).toEqual([])
  })

  it('refuses on a blank cafe id rather than asking naver for one', async () => {
    const { run, repos, settings, boards } = buildWithOptions([], {})
    enable(repos)
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    settings.set(SETTING_KEYS.cafeId, '   ')

    expect(await run()).toEqual({ opened: false, reason: 'NOT_CONFIGURED' })
    expect(boards).toEqual([])
  })

  it('refuses while the automation is disabled', async () => {
    const { run, repos } = build([candidate('1001')])
    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: BOARD,
    })
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    expect(await run()).toEqual({ opened: false, reason: 'DISABLED' })
  })

  it('refuses when no template is registered', async () => {
    const { run, repos } = build([candidate('1002')])
    enable(repos)

    expect(await run()).toEqual({ opened: false, reason: 'NO_TEMPLATE' })
  })

  it('renders the registered template with the author nickname', async () => {
    const { run, repos, executed } = build([candidate('1003')])
    enable(repos)
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: 1,
    })

    expect(await run()).toMatchObject({ opened: true, executed: 1 })
    expect(executed).toEqual(['신입회원님 환영합니다'])
  })

  it('treats a missing nickname as a risk flag rather than posting a broken greeting', async () => {
    const { run, repos, executed } = build([candidate('1004', null)])
    enable(repos)
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: 1,
    })

    expect(await run()).toMatchObject({ opened: true, executed: 0, skipped: 1 })
    expect(executed).toEqual([])
  })

  it('picks up a policy change without a restart', async () => {
    const { run, repos } = build([candidate('3001')])
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'MANUAL',
      limits: {},
      enabled: true,
      boardId: BOARD,
    })

    expect(await run()).toMatchObject({ opened: true, executed: 0, awaitingApproval: 1 })
  })

  it('honours a per-automation limit override', async () => {
    const { run, repos } = build([candidate('4001'), candidate('4002')])
    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: { perSessionCap: 1 },
      enabled: true,
      boardId: BOARD,
    })
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    expect(await run()).toMatchObject({ opened: true, executed: 1 })
  })

  it('executes a post whose only comments come from ordinary members', async () => {
    // The lookup resolves who commented, so we can distinguish member-only comments
    // from operator comments. Posts with member-only comments get greeted.
    const memberOnly = {
      ...candidate('5001'),
      commentCount: 1,
    }
    const { run, repos, settings, executed } = buildWithOptions([memberOnly], {
      commentsByPostId: {
        '5001': [{ nickname: 'member1', memberKey: 'key1' }],
      },
    })
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })
    settings.set(SETTING_KEYS.operatorAccounts, JSON.stringify(['cafe-ops', 'staff-personal']))

    expect(await run()).toMatchObject({ opened: true, executed: 1, skipped: 0 })
    expect(executed).toEqual(['hi'])
  })

  it('skips a post an operator has already answered', async () => {
    // When the lookup shows an operator has commented, the post is skipped
    // with reason ALREADY_COMMENTED.
    const operatorGreeted = {
      ...candidate('5002'),
      commentCount: 1,
    }
    const { run, repos, settings } = buildWithOptions([operatorGreeted], {
      commentsByPostId: {
        '5002': [{ nickname: 'cafe-ops', memberKey: 'key-ops' }],
      },
    })
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })
    settings.set(SETTING_KEYS.operatorAccounts, JSON.stringify(['cafe-ops', 'staff-personal']))

    expect(await run()).toMatchObject({ opened: true, executed: 0, skipped: 1 })
    expect(db.select().from(executions).all()[0]?.reason).toBe('ALREADY_COMMENTED')
  })
})

describe('the settled-day record', () => {
  it('reads nothing when the setting has never been written', async () => {
    // A fresh install has settled no days. Reading it as day zero would make
    // every day since the epoch look owed.
    const { run, repos, settings } = build([])
    settings.remove(SETTING_KEYS.lastSettledDay)
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    await run({ mode: 'SCHEDULED' })
    expect(settings.get(SETTING_KEYS.lastSettledDay)).toBeDefined()
  })

  it('writes the day it settled', async () => {
    const { run, repos, settings } = build([])
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    await run({ mode: 'SCHEDULED' })
    const written = Number(settings.get(SETTING_KEYS.lastSettledDay))
    expect(written).toBe(kstDayStartMs(MON_10_00) - 86_400_000)
  })

  it('ignores a value that is not a number', async () => {
    // A hand-edited or half-written setting must not stop the tool; the worst
    // it should cost is one redundant collection.
    const { run, repos, settings } = build([])
    settings.set(SETTING_KEYS.lastSettledDay, 'yesterday-ish')
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    const outcome = await run({ mode: 'SCHEDULED' })
    expect(outcome.opened).toBe(true)
  })

  it('refuses a settled day later than today', async () => {
    // No day after today can have been settled, so a value from the future was
    // never written by this tool — a hand-edited setting, or a clock that has
    // since moved back. Believed, it would compare as already settled every day
    // from here on and the tool would stop settling for good, without an error
    // to read: the one failure this design cannot survive. Refusing it costs a
    // redundant collection and nothing else, so the session still settles.
    const { run, repos, settings } = build([])
    settings.set(SETTING_KEYS.lastSettledDay, String(kstDayStartMs(MON_10_00) + 30 * 86_400_000))
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    await run({ mode: 'SCHEDULED' })

    expect(Number(settings.get(SETTING_KEYS.lastSettledDay))).toBe(
      kstDayStartMs(MON_10_00) - 86_400_000,
    )
  })

  it('believes a settled day of today itself', async () => {
    // Today's own midnight is a value this tool can legitimately have written —
    // an operator's dated run on today, say — so the future check must sit
    // strictly above it rather than swallowing the boundary.
    const { run, repos, settings } = build([])
    settings.set(SETTING_KEYS.lastSettledDay, String(kstDayStartMs(MON_10_00)))
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    await run({ mode: 'SCHEDULED' })

    expect(Number(settings.get(SETTING_KEYS.lastSettledDay))).toBe(kstDayStartMs(MON_10_00))
  })
})
