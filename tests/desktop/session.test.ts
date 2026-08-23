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
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)
const CAFE = '10000000'
const BOARD = '5'

function candidate(postId: string, nickname: string | null = '신입회원'): RawCandidate {
  return {
    postId,
    title: '가입인사',
    bodyText: nickname ? `${nickname}님이 우리 카페에 가입하였습니다.\n댓글로 ${nickname}님을 환영해주세요.` : '반갑습니다',
    authorNickname: nickname,
    authorId: 'm1',
    postedAt: MON_10_00 - 60_000,
    existingCommentAuthors: [],
  }
}

function transportWith(candidates: RawCandidate[]) {
  const executed: string[] = []
  /** Every board the session actually asked about, in order. */
  const boards: string[] = []
  return {
    executed,
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
          return Promise.resolve({ type: 'COMMENTS', requestId: message.requestId, authors: [] })
        }
        if (message.type === 'EXECUTE') {
          executed.push(message.action.body)
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

function build(candidates: RawCandidate[]) {
  const { transport, executed, boards } = transportWith(candidates)
  const repos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings: createAutomationSettingsRepo(db),
    dedupe: createSqliteDedupeStore(db, () => `exec-${++counter}`),
  }
  const settings = createSettingsRepo(db)
  const run = createSessionRunner({
    automationId: WELCOME_AUTOMATION_ID,
    profile: 'production',
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([0]),
    transport,
    repos,
    settings,
    isKilled: () => false,
    sleep: () => Promise.resolve(),
    newId: () => `req-${++counter}`,
  })
  return { run, repos, settings, executed, boards }
}

function enable(repos: ReturnType<typeof build>['repos']): void {
  repos.automationSettings.upsert({
    automationId: WELCOME_AUTOMATION_ID,
    policy: 'AUTO',
    limits: {},
    enabled: true,
    boardId: null,
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

describe('createSessionRunner', () => {
  it('watches the board recorded on the automation, not the global setting', async () => {
    const { run, repos, settings, boards } = build([])
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

  it('falls back to the default board when the automation has none', async () => {
    const { run, repos, settings, boards } = build([])
    enable(repos)
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    settings.set(SETTING_KEYS.cafeId, CAFE)

    await run()

    expect(boards).toEqual([BOARD])
  })

  it('refuses while the automation is disabled', async () => {
    const { run, repos } = build([candidate('1001')])
    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: null,
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
      boardId: null,
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
      boardId: null,
    })
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })

    expect(await run()).toMatchObject({ opened: true, executed: 1 })
  })

  it('skips a post any configured operator account already greeted', async () => {
    const greeted = {
      ...candidate('5001'),
      existingCommentAuthors: [{ nickname: 'staff-personal', memberKey: 'key-staff' }],
    }
    const { run, repos, settings } = build([greeted])
    enable(repos)
    repos.templates.add({ id: 't1', automationId: WELCOME_AUTOMATION_ID, body: 'hi', createdAt: 1 })
    settings.set(SETTING_KEYS.operatorAccounts, JSON.stringify(['cafe-ops', 'staff-personal']))

    expect(await run()).toMatchObject({ opened: true, executed: 0, skipped: 1 })
    expect(db.select().from(executions).all()[0]?.reason).toBe('ALREADY_COMMENTED')
  })
})
