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
import { createRendererApi } from '../../src/desktop/rendererApi.js'
import type { AppRepos, AutomationControl } from '../../src/desktop/bootstrap.js'
import type { CollectionJob } from '../../src/desktop/collection-db/statusQuery.js'
import type { CollectionRepository } from '../../src/desktop/collection-db/repository.js'
import type { MemberFeedState, MemberRepository } from '../../src/desktop/collection-db/memberRepository.js'
import type { MemberCollectionStatus } from '../../src/desktop/collection-db/memberStatusQuery.js'
import type { CollectionStartRequest } from '../../src/desktop/collectionRunner.js'
import type { MemberCollectionStartRequest } from '../../src/desktop/memberCollectionRunner.js'
import type { SessionProgress } from '../../src/desktop/orchestrator.js'
import type { WarmCheck } from '../../src/desktop/sessionWarmer.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock } from '../fakes.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

let dir: string
let db: AppDatabase
let counter = 0
let control: { running: boolean; killed: boolean; ranOnce: number }
let shell: { setupOpened: number; recoveryOpened: number; copied: string[] }
/**
 * A filesystem the size of this test. `savePath`/`openPath` stand in for what
 * the operator picked, and null for a dialog they closed.
 */
let files: {
  savePath: string | null
  openPath: string | null
  written: { path: string; text: string }[]
  contents: Map<string, string>
  readError: Error | null
}
let progress: SessionProgress | null
let lastWarm: WarmCheck | null

interface BridgeOverrides {
  /** Whether the socket is up right now. */
  readonly connected?: boolean
  /** When the bridge was last seen up, or null if it never was. */
  readonly lastSeenConnectedAt?: number | null
}

/**
 * What a collection database would answer, for the tests that need one. The
 * default is no database at all, which is what an install without collection
 * storage runs as.
 */
interface CollectionOverrides {
  /** The unfinished job in `feed_state`, or null when none has been asked for. */
  readonly job?: CollectionJob | null
  readonly runnerBusy?: boolean
  /** Member feed state returned by memberRepository.readMemberFeedState(). */
  readonly memberFeedState?: MemberFeedState | null
  /** Override for what memberStatus.read() returns. */
  readonly memberStatus?: Partial<MemberCollectionStatus>
}

function build(nowMs = MON_10_00, bridge: BridgeOverrides = {}, collection: CollectionOverrides = {}) {
  /** Every start the api asked for, so the resume flag can be read back. */
  const started: CollectionStartRequest[] = []
  /** Every member start the api asked for. */
  const memberStarted: MemberCollectionStartRequest[] = []
  /** Whether the member runner's stop() was called. */
  const memberStopped: boolean[] = []
  /** What the api wrote as the force on the member repo. */
  const memberForcedCalls: (Date | null)[] = []
  /** What the api wrote as the force, newest last; null means released. */
  const forcedCalls: (Date | null)[] = []
  /** Counts re-lays, since forcing is pointless if the beat is not moved. */
  const refreshes = { count: 0 }
  const repos: AppRepos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings: createAutomationSettingsRepo(db),
    dedupe: createSqliteDedupeStore(db, () => `exec-${++counter}`),
  }
  const settings = createSettingsRepo(db)
  control = { running: false, killed: false, ranOnce: 0 }
  shell = { setupOpened: 0, recoveryOpened: 0, copied: [] }
  files = {
    savePath: '/picked/settings.json',
    openPath: null,
    written: [],
    contents: new Map(),
    readError: null,
  }
  progress = null
  lastWarm = null
  const clock = new FakeClock(nowMs)
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
    bridge: {
      isConnected: () => bridge.connected ?? true,
      request: () => Promise.reject(new Error('not used in this test')),
    },
    // These tests cover the SQLite-backed screens, which stay whole without
    // collection storage — the state an operator without one actually runs in.
    collection: () =>
      collection.job === undefined
        ? { kind: 'disabled', close: () => Promise.resolve() }
        : {
            kind: 'ready',
            close: () => Promise.resolve(),
            // Reading is all the api does with storage; a repository that
            // throws on any touch proves that rather than assuming it.
            repository: {
              setForced: (_feed: unknown, forcedAt: Date | null) => {
                forcedCalls.push(forcedAt)
                return Promise.resolve()
              },
            } as unknown as CollectionRepository,
            status: {
              read: () =>
                Promise.resolve({
                  totals: { posts: 0, boards: 0, oldestPostedAtMs: null, newestPostedAtMs: null, lastSnapshotAtMs: null },
                  job: collection.job ?? null,
                  running: null,
                  recentRuns: [],
                }),
            },
            memberRepository: {
              readMemberFeedState: () => Promise.resolve(collection.memberFeedState ?? null),
              setForced: (forcedAt: Date | null) => {
                memberForcedCalls.push(forcedAt)
                return Promise.resolve()
              },
            } as unknown as MemberRepository,
            memberStatus: {
              read: () =>
                Promise.resolve({
                  memberCount: 0,
                  pagesStored: 0,
                  totalMemberCount: null,
                  complete: false,
                  forced: false,
                  completedAtMs: null,
                  toppedUpAtMs: null,
                  running: false,
                  authorCount: 0,
                  matchedAuthorCount: 0,
                  ...collection.memberStatus,
                }),
            },
          },
    collectionRunner: {
      start: (request) => {
        started.push(request)
        return collection.job === undefined ? { kind: 'refused', reason: 'NO_STORAGE' } : { kind: 'started' }
      },
      stop: () => undefined,
      isRunning: () => collection.runnerBusy ?? false,
    },
    memberCollectionRunner: {
      start: (request: MemberCollectionStartRequest) => {
        memberStarted.push(request)
        return { kind: 'started' as const }
      },
      stop: () => {
        memberStopped.push(true)
      },
      isRunning: () => false,
    },
    collectionLoop: {
      refresh: () => {
        refreshes.count += 1
      },
      stop: () => undefined,
      nextRunAt: () => null,
    },
    automation,
    lastOutcome: () => ({ opened: false, reason: 'NO_TEMPLATE' }),
    lastOutcomeAt: () => null,
    getStartupPreview: () => null,
    getDayPreview: () => null,
    lastBridgeConnectedAt: () => bridge.lastSeenConnectedAt ?? null,
    nextSessionAt: () => null,
    lastWarm: () => lastWarm,
    sessionProgress: () => progress,
    previewDay: () =>
      Promise.resolve({ kind: 'READY' as const, count: 0, alreadyHandled: 0, pending: 0, checkedAt: 0 }),
    openExtensionSetup: () => {
      shell.setupOpened += 1
      return { extensionDir: '/staged/chrome-extension', chromeOpened: true }
    },
    recoverExtensionSetup: () => {
      shell.recoveryOpened += 1
      settings.remove('boundExtensionId')
      return {
        extensionDir: '/staged/chrome-extension',
        chromeOpened: true,
        pairingToken: 'new-token',
      }
    },
    copyToClipboard: (text) => {
      shell.copied.push(text)
    },
    configFile: {
      chooseSavePath: () => Promise.resolve(files.savePath),
      chooseOpenPath: () => Promise.resolve(files.openPath),
      writeText: (path, text) => {
        files.written.push({ path, text })
        files.contents.set(path, text)
      },
      readText: (path) => {
        if (files.readError !== null) throw files.readError
        const text = files.contents.get(path)
        if (text === undefined) throw new Error(`no such file: ${path}`)
        return text
      },
    },
    // The real database, so the nesting inside `replaceAll` is exercised here
    // rather than assumed.
    transaction: (run) => {
      db.transaction(() => {
        run()
      })
    },
    clock,
    limits: PROFILES.production,
    newId: () => `new-${++counter}`,
  })
  return { api, repos, settings, clock, started, forcedCalls, refreshes, memberStarted, memberStopped, memberForcedCalls }
}

async function seedAwaiting(
  repos: AppRepos,
  postId: string,
  postedAt = MON_10_00 - 60_000,
): Promise<string> {
  const id = await repos.dedupe.claim({
    automationId: WELCOME_AUTOMATION_ID,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: '가입인사',
    authorNickname: '신입회원',
    authorId: 'm1',
    postedAt,
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
      dayPreview: null,
      lastOutcomeAt: null,
      nextSessionAt: null,
      sessionProgress: null,
      lastWarm: null,
      bridgeStatus: 'CONNECTED',
      extensionEverPaired: false,
      withinActiveHours: true,
      activeHourStart: 10,
      activeHourEnd: 24,
      averageActionGapMs: 40_000,
    })
  })

  it('carries the operating window itself, not only whether it is open now', async () => {
    // The dashboard draws the window as a band, which needs both ends. Taken
    // from the profile so the screen never works the hours out a second time.
    const { api } = build()
    const dashboard = await api.getDashboard()

    expect(dashboard.activeHourStart).toBe(PROFILES.production.activeHourStart)
    expect(dashboard.activeHourEnd).toBe(PROFILES.production.activeHourEnd)
  })

  it('carries the last naver session check to the screen', async () => {
    const { api } = build()
    lastWarm = { at: MON_10_00, loggedIn: true }

    expect((await api.getDashboard()).lastWarm).toEqual({ at: MON_10_00, loggedIn: true })
  })

  it('carries one answer about the bridge, not two that can disagree', async () => {
    // A raw boolean alongside the status is what split the window in half: the
    // sidebar read the boolean and flashed "끊김" on every service worker cycle
    // while the dashboard, reading the status, correctly said "연결 대기 중".
    expect(await build().api.getDashboard()).not.toHaveProperty('bridgeConnected')
  })

  it('reports whether the operating window is open, so the screen need not work it out', async () => {
    expect((await build(MON_10_00).api.getDashboard()).withinActiveHours).toBe(true)

    // 03:00 is before the window opens; this is the state that makes the
    // screen ask before running instead of running.
    const night = Date.UTC(2026, 7, 24, 3, 0, 0)
    expect((await build(night).api.getDashboard()).withinActiveHours).toBe(false)
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

  it('leaves an earlier day being filled in out of today\'s figures', async () => {
    const { api, repos } = build()
    // The post is two days old; the comment goes out now. It is work done
    // today, but it is not today's work, and today's numbers say so.
    const id = await seedAwaiting(repos, '1001', MON_10_00 - 2 * 86_400_000)

    repos.executions.applyPatch(id, {
      status: 'SUCCESS',
      executedAt: MON_10_00 - 1_000,
      resolvedAt: MON_10_00 - 1_000,
    })

    expect(await api.getDashboard()).toMatchObject({ executedToday: 0, succeededToday: 0 })
  })

  it('counts a post from today whenever the comment went out', async () => {
    const { api, repos } = build()
    const id = await seedAwaiting(repos, '1005')

    repos.executions.applyPatch(id, {
      status: 'SUCCESS',
      executedAt: MON_10_00 - 1_000,
      resolvedAt: MON_10_00 - 1_000,
    })

    expect(await api.getDashboard()).toMatchObject({ executedToday: 1, succeededToday: 1 })
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
  it('shows empty boxes before anything is configured, not a cafe nobody chose', async () => {
    const { api } = build()

    expect(await api.getCommonSettings()).toEqual({
      cafeId: '',
      cafeUrlName: '',
      operatorAccounts: [],
    })
    expect(await api.getAutomationSettings(WELCOME_AUTOMATION_ID)).toEqual({
      policy: 'AUTO',
      enabled: false,
      boardId: '',
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
    // Blank, not somebody else's board: an automation nobody has pointed at a
    // board has no board.
    expect((await api.getAutomationSettings('other-automation')).boardId).toBe('')
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

  it('hands the setup press to the shell and reports what it opened', async () => {
    const { api } = build()

    expect(await api.openExtensionSetup()).toEqual({
      extensionDir: '/staged/chrome-extension',
      chromeOpened: true,
    })
    expect(shell.setupOpened).toBe(1)
  })

  it('hands recovery to the shell and clears the previous binding', async () => {
    const { api, settings } = build()
    settings.set('boundExtensionId', 'old-extension-id')

    expect(await api.recoverExtensionSetup()).toEqual({
      extensionDir: '/staged/chrome-extension',
      chromeOpened: true,
      pairingToken: 'new-token',
    })
    expect(shell.recoveryOpened).toBe(1)
    expect(settings.get('boundExtensionId')).toBeUndefined()
  })

  it('copies through the shell rather than the renderer', async () => {
    const { api } = build()
    await api.copyToClipboard('token-abc')
    expect(shell.copied).toEqual(['token-abc'])
  })
})

/**
 * The first-run guide is offered on this alone, so it has to mean "never set
 * up" and nothing else. A browser that is merely closed is not a fresh install.
 */
describe('extension ever paired', () => {
  it('is false on an install no extension has ever reached', async () => {
    const { api } = build()

    expect((await api.getDashboard()).extensionEverPaired).toBe(false)
  })

  it('stays true once an extension has been bound, with the socket down', async () => {
    const { api, settings } = build(MON_10_00, { connected: false, lastSeenConnectedAt: null })
    settings.set('boundExtensionId', 'abcdefghijklmnopabcdefghijklmnop')

    const dashboard = await api.getDashboard()
    expect(dashboard.bridgeStatus).toBe('RECONNECTING')
    expect(dashboard.extensionEverPaired).toBe(true)
  })
})

describe('bridge status', () => {
  const GRACE_MS = 90 * 1000

  it('reports a live socket as connected', async () => {
    const { api } = build(MON_10_00, { connected: true })

    expect((await api.getDashboard()).bridgeStatus).toBe('CONNECTED')
  })

  it('gives a previously paired extension one reconnect cycle after app startup', async () => {
    const { api, settings, clock } = build(MON_10_00, {
      connected: false,
      lastSeenConnectedAt: null,
    })
    settings.set('boundExtensionId', 'abcdefghijklmnopabcdefghijklmnop')

    expect((await api.getDashboard()).bridgeStatus).toBe('RECONNECTING')

    clock.set(MON_10_00 + GRACE_MS + 1)
    expect((await api.getDashboard()).bridgeStatus).toBe('OFFLINE')
  })

  it('holds a dropped socket at reconnecting while the worker cycles', async () => {
    const { api } = build(MON_10_00, { connected: false, lastSeenConnectedAt: MON_10_00 - 30_000 })

    expect((await api.getDashboard()).bridgeStatus).toBe('RECONNECTING')
  })

  it('falls to offline once the silence outlasts the grace period', async () => {
    const { api } = build(MON_10_00, { connected: false, lastSeenConnectedAt: MON_10_00 - GRACE_MS - 1 })

    expect((await api.getDashboard()).bridgeStatus).toBe('OFFLINE')
  })

  it('reports offline when the bridge has never been up', async () => {
    const { api } = build(MON_10_00, { connected: false, lastSeenConnectedAt: null })

    expect((await api.getDashboard()).bridgeStatus).toBe('OFFLINE')
  })

  it('measures the gap from when the bridge was last seen, not from the first time it paired', async () => {
    // An hour into a healthy session the extension cycles its worker. Measured
    // from the first pairing that reads as long dead; measured from the last
    // sighting it is the ordinary two-second gap it actually is.
    const { api } = build(MON_10_00, { connected: false, lastSeenConnectedAt: MON_10_00 - 2_000 })

    expect((await api.getDashboard()).bridgeStatus).toBe('RECONNECTING')
  })
})

describe('exportConfig', () => {
  it('writes the configuration to the chosen path and says where', async () => {
    const { api, settings } = build()
    settings.set('cafeId', '10000000')
    settings.set('cafeUrlName', 'devcafe')

    expect(await api.exportConfig()).toEqual({ kind: 'SAVED', path: '/picked/settings.json' })
    expect(files.written).toHaveLength(1)
    expect(JSON.parse(files.written[0]!.text)).toMatchObject({
      version: 1,
      common: { cafeId: '10000000', cafeUrlName: 'devcafe' },
    })
  })

  it('writes nothing when the operator closes the dialog', async () => {
    const { api } = build()
    files.savePath = null

    expect(await api.exportConfig()).toEqual({ kind: 'CANCELLED' })
    expect(files.written).toEqual([])
  })

  it('leaves the pairing token out of the file', async () => {
    const { api, settings } = build()
    settings.set('cafeId', '10000000')
    settings.set('pairingToken', 'this-machines-secret')

    await api.exportConfig()

    expect(files.written[0]?.text).not.toContain('this-machines-secret')
  })
})

describe('importConfig', () => {
  const FILE = JSON.stringify({
    version: 1,
    exportedAt: 0,
    common: { cafeId: '31068798', cafeUrlName: 'whiskyclub', operatorAccounts: ['staff1'] },
    automations: [
      {
        id: WELCOME_AUTOMATION_ID,
        policy: 'SEMI',
        boardId: '42',
        enabled: true,
        templates: [{ body: '환영합니다', enabled: true }],
      },
    ],
  })

  function pick(contents: string): void {
    files.openPath = '/chosen/settings.json'
    files.contents.set('/chosen/settings.json', contents)
  }

  it('applies the file and reports what it changed', async () => {
    const { api } = build()
    pick(FILE)

    expect(await api.importConfig()).toEqual({
      kind: 'IMPORTED',
      automationCount: 1,
      templateCount: 1,
      enabledCount: 1,
    })
    expect(await api.getCommonSettings()).toEqual({
      cafeId: '31068798',
      cafeUrlName: 'whiskyclub',
      operatorAccounts: ['staff1'],
    })
    expect(await api.getAutomationSettings(WELCOME_AUTOMATION_ID)).toEqual({
      policy: 'SEMI',
      enabled: true,
      boardId: '42',
    })
  })

  it('changes nothing when the operator closes the dialog', async () => {
    const { api, settings } = build()
    settings.set('cafeId', '10000000')
    files.openPath = null

    expect(await api.importConfig()).toEqual({ kind: 'CANCELLED' })
    expect((await api.getCommonSettings()).cafeId).toBe('10000000')
  })

  it('names why a file was turned away and leaves the settings alone', async () => {
    const { api, settings } = build()
    settings.set('cafeId', '10000000')
    pick('{"not":"ours"}')

    expect(await api.importConfig()).toEqual({ kind: 'REJECTED', problem: 'NOT_A_BUNDLE' })
    expect((await api.getCommonSettings()).cafeId).toBe('10000000')
  })

  it('lets a failure to read the file through to the error banner', async () => {
    const { api } = build()
    pick(FILE)
    files.readError = new Error('EACCES')

    await expect(api.importConfig()).rejects.toThrow('EACCES')
  })

  it('replaces the templates that were here', async () => {
    const { api, repos } = build()
    repos.templates.add({
      id: 'old',
      automationId: WELCOME_AUTOMATION_ID,
      body: '개발 문구',
      createdAt: 1,
    })
    pick(FILE)

    await api.importConfig()

    expect((await api.listTemplates(WELCOME_AUTOMATION_ID)).map((t) => t.body)).toEqual([
      '환영합니다',
    ])
  })
})

describe('asking for a period while a job is unfinished', () => {
  const DAY = 86_400_000
  /** 8월 20일 00:00 KST부터 8월 23일 자정까지 — 화면이 고르는 것과 같은 경계. */
  const firstDayMs = Date.UTC(2026, 7, 19, 15, 0, 0)
  const lastDayMs = firstDayMs + 2 * DAY
  const targetStartMs = firstDayMs
  const targetEndMs = lastDayMs + DAY

  function job(overrides: Partial<CollectionJob> = {}): CollectionJob {
    return {
      targetStartMs,
      targetEndMs,
      // Two of the three days walked.
      cursorPostedAtMs: targetStartMs + DAY,
      cursorUpdatedAtMs: MON_10_00 - 3_600_000,
      complete: false,
      forced: false,
      ...overrides,
    }
  }

  it('carries on from the cursor when the period is the one already under way', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job() })

    const result = await api.startCollection({ firstDayMs, lastDayMs })

    expect(result).toEqual({ kind: 'started' })
    expect(started[0]?.resumeFromCheckpoint).toBe(true)
  })

  it('asks before replacing a different period, and starts nothing yet', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job() })

    const result = await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs })

    expect(result.kind).toBe('needs_replace')
    if (result.kind !== 'needs_replace') return
    // The panel is shown the job itself, which is what it puts in front of the
    // operator before they answer.
    expect(result.job.targetStartMs).toBe(targetStartMs)
    expect(result.job.cursorPostedAtMs).toBe(targetStartMs + DAY)
    expect(started).toEqual([])
  })

  it('starts the new period from scratch once the operator has answered', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job() })

    const result = await api.startCollection({
      firstDayMs: firstDayMs - 7 * DAY,
      lastDayMs,
      replace: true,
    })

    expect(result).toEqual({ kind: 'started' })
    // A fresh cursor is what makes it a replacement rather than a resume; the
    // repository resets `feed_state` on exactly this flag.
    expect(started[0]?.resumeFromCheckpoint).toBe(false)
    expect(started[0]?.range.startMs).toBe(firstDayMs - 7 * DAY)
  })

  it('does not ask about a job that has already finished its period', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job({ complete: true }) })

    const result = await api.startCollection({ firstDayMs: firstDayMs - 7 * DAY, lastDayMs })

    expect(result).toEqual({ kind: 'started' })
    expect(started[0]?.resumeFromCheckpoint).toBe(false)
  })

  it('sends the operator to stop the walk before changing the period under it', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job(), runnerBusy: true })

    const result = await api.startCollection({
      firstDayMs: firstDayMs - 7 * DAY,
      lastDayMs,
      replace: true,
    })

    // Resetting the cursor while a run is writing it would race; the walk ends
    // at its own page boundary, so the operator stops it first.
    expect(result).toEqual({ kind: 'refused', reason: 'STOP_RUNNING_FIRST' })
    expect(started).toEqual([])
  })

  it('carries the stored job on when no period is named', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job() })

    const result = await api.startCollection()

    expect(result).toEqual({ kind: 'started' })
    expect(started[0]?.resumeFromCheckpoint).toBe(true)
    // The job's own period, not a window assumed on the operator's behalf.
    expect(started[0]?.range).toEqual({ startMs: targetStartMs, endMs: targetEndMs })
  })

  it('has nothing to carry on with before a period has been asked for', async () => {
    const { api, started } = build(MON_10_00, {}, { job: null })

    expect(await api.startCollection()).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(started).toEqual([])
  })

  it('says the period is done rather than starting a walk that would end at once', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job({ complete: true }) })

    expect(await api.startCollection()).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
    expect(started).toEqual([])
  })

  it('names the missing database rather than the missing job', async () => {
    const { api } = build()

    expect(await api.startCollection()).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
  })

  it('reads a finished period over again rather than resuming a cursor at its end', async () => {
    const { api, started } = build(MON_10_00, {}, { job: job({ complete: true }) })

    const result = await api.startCollection({ firstDayMs, lastDayMs })

    expect(result).toEqual({ kind: 'started' })
    // Asking for the same period again is a request to read it over; resuming
    // would start at the end of it and finish having stored nothing.
    expect(started[0]?.resumeFromCheckpoint).toBe(false)
  })

  it('starts fresh when no period has ever been asked for', async () => {
    const { api, started } = build(MON_10_00, {}, { job: null })

    const result = await api.startCollection({ firstDayMs, lastDayMs })

    expect(result).toEqual({ kind: 'started' })
    expect(started[0]?.resumeFromCheckpoint).toBe(false)
  })
})

describe('running the collection around the clock', () => {
  const DAY = 86_400_000
  const firstDayMs = Date.UTC(2026, 7, 19, 15, 0, 0)

  function job(overrides: Partial<CollectionJob> = {}): CollectionJob {
    return {
      targetStartMs: firstDayMs,
      targetEndMs: firstDayMs + 3 * DAY,
      cursorPostedAtMs: firstDayMs + DAY,
      cursorUpdatedAtMs: MON_10_00 - 3_600_000,
      complete: false,
      forced: false,
      ...overrides,
    }
  }

  it('marks the job forced and moves the beat that was already laid', async () => {
    const { api, forcedCalls, refreshes } = build(MON_10_00, {}, { job: job() })

    expect(await api.setCollectionForced(true)).toEqual({ kind: 'set', forced: true })
    expect(forcedCalls).toHaveLength(1)
    expect(forcedCalls[0]).toBeInstanceOf(Date)
    // Without this the force changes nothing until the next beat, which under
    // the old rule may be nine o'clock tomorrow — the very thing it is for.
    expect(refreshes.count).toBe(1)
  })

  it('releases the job and moves the beat back', async () => {
    const { api, forcedCalls, refreshes } = build(MON_10_00, {}, { job: job({ forced: true }) })

    expect(await api.setCollectionForced(false)).toEqual({ kind: 'set', forced: false })
    expect(forcedCalls).toEqual([null])
    expect(refreshes.count).toBe(1)
  })

  it('has nothing to force before a period has been asked for', async () => {
    const { api, forcedCalls } = build(MON_10_00, {}, { job: null })

    expect(await api.setCollectionForced(true)).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(forcedCalls).toEqual([])
  })

  it('refuses to stay up for a period already walked to its end', async () => {
    const { api, forcedCalls } = build(MON_10_00, {}, { job: job({ complete: true }) })

    expect(await api.setCollectionForced(true)).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
    expect(forcedCalls).toEqual([])
  })

  it('names the missing database rather than the missing job', async () => {
    const { api } = build()

    expect(await api.setCollectionForced(true)).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
  })
})

describe('getMemberCollectionStatus', () => {
  it('reports disabled when there is no collection database', async () => {
    const { api } = build()
    expect(await api.getMemberCollectionStatus()).toEqual({ kind: 'disabled' })
  })

  it('reports ready with status when a database is open', async () => {
    const { api } = build(MON_10_00, {}, { job: null, memberStatus: { memberCount: 42, authorCount: 10, matchedAuthorCount: 7 } })
    const result = await api.getMemberCollectionStatus()
    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(result.status.memberCount).toBe(42)
      expect(result.status.authorCount).toBe(10)
      expect(result.status.matchedAuthorCount).toBe(7)
    }
  })
})

describe('startMemberCollection', () => {
  it('starts a backfill on first run (no existing feed state)', async () => {
    const { api, memberStarted } = build(MON_10_00, {}, { job: null })
    const result = await api.startMemberCollection()
    expect(result).toEqual({ kind: 'started' })
    expect(memberStarted).toHaveLength(1)
    expect(memberStarted[0]?.mode).toBe('backfill')
    expect(memberStarted[0]?.resumeFromCheckpoint).toBe(false)
  })

  it('starts incremental and resumes from checkpoint when a walk already exists', async () => {
    const feedState: MemberFeedState = {
      stateVersion: 0, anchorMemberKey: null,
      anchorJoinDate: null, referencePage: null, pageIdentity: null,
      totalMemberCount: null, cursorUpdatedAtMs: MON_10_00,
      complete: false, forced: false, toppedUpAtMs: null,
    }
    const { api, memberStarted } = build(MON_10_00, {}, { job: null, memberFeedState: feedState })
    const result = await api.startMemberCollection()
    expect(result).toEqual({ kind: 'started' })
    expect(memberStarted[0]?.mode).toBe('incremental')
    expect(memberStarted[0]?.resumeFromCheckpoint).toBe(true)
  })

  it('refuses with JOB_FINISHED when the feed state is complete', async () => {
    const feedState: MemberFeedState = {
      stateVersion: 0, anchorMemberKey: null,
      anchorJoinDate: null, referencePage: null, pageIdentity: null,
      totalMemberCount: null, cursorUpdatedAtMs: MON_10_00,
      complete: true, forced: false, toppedUpAtMs: null,
    }
    const { api } = build(MON_10_00, {}, { job: null, memberFeedState: feedState })
    expect(await api.startMemberCollection()).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
  })

  it('refuses with NO_STORAGE when the collection database is absent', async () => {
    const { api } = build()
    expect(await api.startMemberCollection()).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
  })

})

describe('stopMemberCollection', () => {
  it('calls the runner stop', async () => {
    const { api, memberStopped } = build(MON_10_00, {}, { job: null })
    await api.stopMemberCollection()
    expect(memberStopped).toHaveLength(1)
  })

})

describe('setMemberCollectionForced', () => {
  const feedState = (overrides: Partial<MemberFeedState> = {}): MemberFeedState => ({
    stateVersion: 0, anchorMemberKey: null,
    anchorJoinDate: null, referencePage: null, pageIdentity: null,
    totalMemberCount: null, cursorUpdatedAtMs: MON_10_00,
    complete: false, forced: false, toppedUpAtMs: null,
    ...overrides,
  })

  it('writes the force timestamp and moves the beat', async () => {
    const { api, memberForcedCalls, refreshes } = build(MON_10_00, {}, { job: null, memberFeedState: feedState() })
    const result = await api.setMemberCollectionForced(true)
    expect(result).toEqual({ kind: 'set', forced: true })
    expect(memberForcedCalls).toHaveLength(1)
    expect(memberForcedCalls[0]).toBeInstanceOf(Date)
    expect(refreshes.count).toBe(1)
  })

  it('clears the force and moves the beat', async () => {
    const { api, memberForcedCalls, refreshes } = build(MON_10_00, {}, { job: null, memberFeedState: feedState({ forced: true }) })
    const result = await api.setMemberCollectionForced(false)
    expect(result).toEqual({ kind: 'set', forced: false })
    expect(memberForcedCalls).toEqual([null])
    expect(refreshes.count).toBe(1)
  })

  it('refuses with NO_JOB when no feed state row exists', async () => {
    const { api, memberForcedCalls } = build(MON_10_00, {}, { job: null })
    expect(await api.setMemberCollectionForced(true)).toEqual({ kind: 'refused', reason: 'NO_JOB' })
    expect(memberForcedCalls).toEqual([])
  })

  it('refuses with JOB_FINISHED when the walk is complete', async () => {
    const { api, memberForcedCalls } = build(MON_10_00, {}, { job: null, memberFeedState: feedState({ complete: true }) })
    expect(await api.setMemberCollectionForced(true)).toEqual({ kind: 'refused', reason: 'JOB_FINISHED' })
    expect(memberForcedCalls).toEqual([])
  })

  it('refuses with NO_STORAGE when the database is absent', async () => {
    const { api } = build()
    expect(await api.setMemberCollectionForced(true)).toEqual({ kind: 'refused', reason: 'NO_STORAGE' })
  })
})
