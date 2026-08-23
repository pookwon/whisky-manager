import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WELCOME_AUTOMATION_ID } from '../../src/desktop/bootstrap.js'
import { createAutomationSettingsRepo } from '../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { createSettingsRepo } from '../../src/desktop/db/settingsRepo.js'
import { createTemplatesRepo } from '../../src/desktop/db/templatesRepo.js'
import { createWatermarksRepo } from '../../src/desktop/db/watermarksRepo.js'
import { createRendererApi } from '../../src/desktop/rendererApi.js'
import type { AppRepos, AutomationControl } from '../../src/desktop/bootstrap.js'
import type { SessionProgress } from '../../src/desktop/orchestrator.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock } from '../fakes.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

let dir: string
let db: AppDatabase
let counter = 0
let control: { running: boolean; killed: boolean; ranOnce: number }
let progress: SessionProgress | null

function build() {
  const repos: AppRepos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings: createAutomationSettingsRepo(db),
    watermarks: createWatermarksRepo(db),
    dedupe: createSqliteDedupeStore(db, () => `exec-${++counter}`),
  }
  const settings = createSettingsRepo(db)
  control = { running: false, killed: false, ranOnce: 0 }
  progress = null
  const automation: AutomationControl = {
    start: () => {
      control.running = true
      control.killed = false
    },
    stop: () => {
      control.running = false
    },
    kill: () => {
      control.running = false
      control.killed = true
    },
    isRunning: () => control.running,
    nextRunAt: () => null,
    runOnce: () => {
      control.ranOnce += 1
      return Promise.resolve()
    },
  }
  const api = createRendererApi({
    repos,
    settings,
    bridge: { isConnected: () => true, request: () => Promise.reject(new Error('not used in this test')) },
    automation,
    lastOutcome: () => ({ opened: false, reason: 'NO_TEMPLATE' }),
    lastOutcomeAt: () => null,
    getStartupPreview: () => null,
    lastBridgeConnectedAt: () => null,
    nextSessionAt: () => null,
    sessionProgress: () => progress,
    clock: new FakeClock(MON_10_00),
    limits: PROFILES.production,
    newId: () => `new-${++counter}`,
  })
  return { api, repos, settings }
}

async function seedAwaiting(repos: AppRepos, postId: string): Promise<string> {
  const id = await repos.dedupe.claim({
    automationId: WELCOME_AUTOMATION_ID,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: '가입인사',
    authorNickname: '신입회원',
    authorId: 'm1',
    postedAt: MON_10_00 - 60_000,
    detectedAt: MON_10_00 - 30_000,
  })
  if (id === null) throw new Error('seed failed')
  repos.executions.applyPatch(id, {
    status: 'AWAITING_APPROVAL',
    renderedText: '신입회원님 환영합니다',
    riskFlags: ['COMMENT_CHECK_FAILED'],
  })
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-api-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('getDashboard', () => {
  it('reports connection, run state and the last refusal', async () => {
    const { api } = build()

    expect(await api.getDashboard()).toEqual({
      bridgeConnected: true,
      loopRunning: false,
      awaitingApproval: 0,
      executedToday: 0,
      succeededToday: 0,
      failedToday: 0,
      lastOutcome: { opened: false, reason: 'NO_TEMPLATE' },
      automations: [
        {
          id: WELCOME_AUTOMATION_ID,
          enabled: false,
          awaitingApproval: 0,
          executedToday: 0,
          lastOutcome: { opened: false, reason: 'NO_TEMPLATE' },
        },
      ],
      startupPreview: null,
      lastOutcomeAt: null,
      nextSessionAt: null,
      sessionProgress: null,
      bridgeStatus: 'CONNECTED',
    })
  })

  it('reports what a session in flight is doing, and nothing when none is', async () => {
    const { api } = build()
    expect((await api.getDashboard()).sessionProgress).toBeNull()

    progress = { phase: 'WORKING', done: 3, total: 10, nickname: '\uc655\ubc24\uc774' }
    expect((await api.getDashboard()).sessionProgress).toEqual({
      phase: 'WORKING',
      done: 3,
      total: 10,
      nickname: '\uc655\ubc24\uc774',
    })
  })

  it('counts today from the operating window start, not midnight', async () => {
    const { api, repos } = build()
    const id = await seedAwaiting(repos, '1001')

    // 07:00 is before the 08:00 window, so it belongs to the previous day.
    repos.executions.applyPatch(id, {
      status: 'SUCCESS',
      executedAt: Date.UTC(2026, 7, 24, 7, 0, 0),
      resolvedAt: Date.UTC(2026, 7, 24, 7, 0, 0),
    })

    expect(await api.getDashboard()).toMatchObject({ executedToday: 0, succeededToday: 0 })
  })

  it('counts an attempt today even when it failed', async () => {
    const { api, repos } = build()
    const id = await seedAwaiting(repos, '1002')
    repos.executions.applyPatch(id, {
      status: 'FAILED',
      executedAt: MON_10_00 - 1_000,
      resolvedAt: MON_10_00 - 1_000,
    })

    expect(await api.getDashboard()).toMatchObject({
      executedToday: 1,
      succeededToday: 0,
      failedToday: 1,
    })
  })
})

describe('approval queue', () => {
  it('lists what the operator needs to judge', async () => {
    const { api, repos } = build()
    const id = await seedAwaiting(repos, '2001')

    expect(await api.listAwaiting(WELCOME_AUTOMATION_ID)).toEqual([
      {
        id,
        postId: '2001',
        author: '신입회원',
        title: '가입인사',
        renderedText: '신입회원님 환영합니다',
        riskFlags: ['COMMENT_CHECK_FAILED'],
        detectedAt: MON_10_00 - 30_000,
      },
    ])
  })

  it('queues an approved item for execution', async () => {
    const { api, repos } = build()
    const id = await seedAwaiting(repos, '2002')

    await api.approve(id)

    expect(repos.executions.getById(id)?.status).toBe('QUEUED')
    expect(await api.listAwaiting(WELCOME_AUTOMATION_ID)).toEqual([])
  })

  it('terminates a rejected item with the operator reason', async () => {
    const { api, repos } = build()
    const id = await seedAwaiting(repos, '2003')

    await api.reject(id)

    const row = repos.executions.getById(id)
    expect(row?.status).toBe('SKIPPED')
    expect(row?.reason).toBe('REJECTED_BY_OPERATOR')
  })
})

describe('templates', () => {
  it('adds, lists and removes', async () => {
    const { api } = build()

    await api.addTemplate(WELCOME_AUTOMATION_ID, '{닉네임}님 환영합니다')
    const listed = await api.listTemplates(WELCOME_AUTOMATION_ID)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.body).toBe('{닉네임}님 환영합니다')

    await api.removeTemplate(listed[0]!.id)
    expect(await api.listTemplates(WELCOME_AUTOMATION_ID)).toEqual([])
  })

  it('refuses a blank template', async () => {
    const { api } = build()
    await expect(api.addTemplate(WELCOME_AUTOMATION_ID, '   ')).rejects.toThrow()
  })
})

describe('settings', () => {
  it('returns defaults before anything is configured', async () => {
    const { api } = build()

    expect(await api.getCommonSettings()).toEqual({
      cafeId: '10000000',
      cafeUrlName: 'examplecafe',
      operatorAccounts: [],
    })
    expect(await api.getAutomationSettings(WELCOME_AUTOMATION_ID)).toEqual({
      policy: 'AUTO',
      enabled: false,
      boardId: '5',
    })
  })

  it('round-trips policy, enabled, cafe and operator accounts', async () => {
    const { api } = build()

    await api.setPolicy(WELCOME_AUTOMATION_ID, 'SEMI')
    await api.setEnabled(WELCOME_AUTOMATION_ID, true)
    await api.setCafe('99999999', 'othercafe')
    await api.setBoardId(WELCOME_AUTOMATION_ID, '7')
    await api.setOperatorAccounts(['cafe-ops', 'staff-personal'])

    expect(await api.getCommonSettings()).toEqual({
      cafeId: '99999999',
      cafeUrlName: 'othercafe',
      operatorAccounts: ['cafe-ops', 'staff-personal'],
    })
    expect(await api.getAutomationSettings(WELCOME_AUTOMATION_ID)).toEqual({
      policy: 'SEMI',
      enabled: true,
      boardId: '7',
    })
  })

  it('keeps templates separate per automation', async () => {
    const { api } = build()
    await api.addTemplate(WELCOME_AUTOMATION_ID, '환영합니다')
    await api.addTemplate('other-automation', '안녕하세요')

    expect((await api.listTemplates(WELCOME_AUTOMATION_ID)).map((t) => t.body)).toEqual([
      '환영합니다',
    ])
    expect((await api.listTemplates('other-automation')).map((t) => t.body)).toEqual(['안녕하세요'])
  })

  it('keeps policy separate per automation', async () => {
    const { api } = build()
    await api.setPolicy(WELCOME_AUTOMATION_ID, 'MANUAL')
    await api.setPolicy('other-automation', 'SEMI')

    expect((await api.getAutomationSettings(WELCOME_AUTOMATION_ID)).policy).toBe('MANUAL')
    expect((await api.getAutomationSettings('other-automation')).policy).toBe('SEMI')
  })

  it('keeps the board separate per automation', async () => {
    const { api } = build()
    await api.setBoardId(WELCOME_AUTOMATION_ID, '77')

    expect((await api.getAutomationSettings(WELCOME_AUTOMATION_ID)).boardId).toBe('77')
    expect((await api.getAutomationSettings('other-automation')).boardId).toBe('5')
  })

  it('drops blank operator accounts', async () => {
    const { api } = build()
    await api.setOperatorAccounts(['cafe-ops', '  ', ''])
    expect((await api.getCommonSettings()).operatorAccounts).toEqual(['cafe-ops'])
  })
})

describe('automation control', () => {
  it('starts, stops and kills', async () => {
    const { api } = build()

    await api.startAutomation()
    expect(control.running).toBe(true)

    await api.stopAutomation()
    expect(control.running).toBe(false)

    await api.killSwitch()
    expect(control.killed).toBe(true)
  })

  it('runs a single session on demand', async () => {
    const { api } = build()
    await api.runOnce()
    expect(control.ranOnce).toBe(1)
  })

  it('exposes the pairing token', async () => {
    const { api, settings } = build()
    settings.set('pairingToken', 'token-abc')
    expect(await api.getPairingToken()).toBe('token-abc')
  })
})
