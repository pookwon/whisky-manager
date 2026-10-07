import { randomUUID } from 'node:crypto'
import {
  PREFIX_REMINDER_AUTOMATION_ID,
  WELCOME_AUTOMATION_ID,
  assertRuntimesRegistered,
} from '../shared/automations/catalog.js'
import { WELCOME_GUARDS } from '../shared/automations/welcome-comment/guards.js'
import {
  renderAnyWelcomeComment,
  renderWelcomeComment,
} from '../shared/automations/welcome-comment/render.js'
import { PREFIX_REMINDER_GUARDS } from '../shared/automations/prefix-reminder/guards.js'
import { PREFIX_REMINDER_LIMITS } from '../shared/automations/prefix-reminder/limits.js'
import { parsePrefixReminderOptions } from '../shared/automations/prefix-reminder/options.js'
import { renderPrefixReminder } from '../shared/automations/prefix-reminder/render.js'
import { createTodayArticleCollector } from './prefixReminderCollection.js'
import { createBoardPageFetcher } from './collectionOrchestrator.js'
import { CAFE_ARTICLE_LIST } from '../shared/cafeArticleFixture.js'
import type { Guard } from '../shared/guards.js'
import { PROFILES } from '../shared/profiles.js'
import { TIMEOUTS } from '../shared/protocol.js'
import type { RenderOutcome } from '../shared/templates.js'
import type { Candidate, Limits, Profile } from '../shared/types.js'
import { createAutomationSettingsRepo, type AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from './db/client.js'
import { createSqliteDedupeStore, type DedupeStore } from './db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from './db/executionsRepo.js'
import { createSettingsRepo, type SettingsRepo } from './db/settingsRepo.js'
import { createTemplatesRepo, type TemplatesRepo } from './db/templatesRepo.js'
import { createDiagnosticsLog, type DiagnosticsLog } from './diagnosticsLog.js'
import { stamp } from './refusalLog.js'
import { systemClock, systemRandom } from './runtime.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { CollectorContext, SessionRequest } from './session.js'
import {
  createSessionRunner,
  settledDayKeyFor,
  SETTING_KEYS,
  parseOperatorAccounts,
  isConfigured,
} from './session.js'
import { createWelcomeDayCollector, type DayCollector } from './collection.js'
import { createAutomationRuntime, type AutomationRuntime } from './automationRuntime.js'
import { createSessionWarmer, type WarmCheck } from './sessionWarmer.js'
import type { LocalConfig } from './localConfig.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'
import { previewDay, type StartupPreview } from './preview.js'
import { createCommentAuthorLookup, type CommentAuthorLookup } from './commentAuthors.js'
import { createCollectGate } from './collectGate.js'
import { createNaverReadGate } from './naverReadGate.js'
import { createCollectionLoop, type CollectionLoop } from './collectionLoop.js'
import { createCollectionRunner, type CollectionRunner } from './collectionRunner.js'
import { createMemberCollectionRunner, type MemberCollectionRunner } from './memberCollectionRunner.js'
import { createCollectionLock } from './collectionLock.js'
import { createBoardSearchRunner, type BoardSearchRunner } from './boardSearchRunner.js'
import { createBoardSearchPageFetcher } from './boardSearchPageFetcher.js'
import { createBoardSearchJob } from './boardSearchJob.js'
import { createArticleProbeRunner, type ArticleProbeRunner } from './articleProbeRunner.js'
import { createArticleFetcher } from './articleFetcher.js'
import { createArticleProbeJob } from './articleProbeJob.js'
import { safeMemberErrorFields } from './memberErrorLog.js'
import { createArticleCollectionJob, createMemberCollectionJob } from './collectionJob.js'
import { readCollectionSchedule } from './collectionSettings.js'
import { readCollectionPacing } from './collectionPacingSettings.js'
import { readMemberResyncInterval } from './memberResyncSettings.js'
import type { MemberWalkRepository } from './collection-db/memberRepository.js'
import { createMemberResyncJob } from './memberResyncJob.js'
import { resolveCollectionDatabaseUrl } from './collectionDatabaseConfig.js'
import { createSessionRecorder, type SessionRecorder } from './sessionLog.js'
import {
  openOptionalCollectionContext,
  type CollectionUnavailableCode,
  type OptionalCollectionContext,
} from './collectionContext.js'

// Re-exported so the many main-process callers keep their existing import.
export { WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'

export interface AppContextOptions {
  readonly databasePath: string
  readonly migrationsFolder: string
  /** Packaged Drizzle migrations for the optional PostgreSQL collection DB. */
  readonly collectionMigrationsFolder?: string
  /**
   * Where the installed build is told which collection database to open.
   * `DATABASE_URL` still wins; an app launched from Finder never has one.
   */
  readonly collectionConfigPath?: string
  /**
   * Where every session — opened or refused, for every automation — is written
   * down, one line each. Omitted means they are not: a dev run or a test has
   * the outcome in front of it already.
   */
  readonly sessionLogPath?: string
  readonly profile: Profile
  readonly bridgePort: number
  /** Fired when the loop stops itself; the shell should show the new state. */
  readonly onHalt?: (reason: 'NOT_LOGGED_IN' | 'LOGIN_CHECK_FAILED') => void
  /** Safe status code only; DATABASE_URL and driver errors never cross this callback. */
  readonly onCollectionUnavailable?: (code: CollectionUnavailableCode) => void
  /**
   * A developer's own cafe, read from a file the repository does not carry.
   * Seeds an unset database and nothing else: values already entered are the
   * operator's and are never overwritten. Packaged builds pass nothing.
   */
  readonly localConfig?: LocalConfig | null
}

export interface AppRepos {
  readonly executions: ExecutionsRepo
  readonly templates: TemplatesRepo
  readonly automationSettings: AutomationSettingsRepo
  readonly dedupe: DedupeStore
}

export interface AutomationControl {
  /** Clears the kill switch and resumes the schedule. */
  start(): void
  /** Pauses the schedule. The kill switch is left as it was. */
  stop(): void
  /** Stops now and refuses every session until started again. */
  kill(): void
  /** True when any automation's loop is running. */
  isRunning(): boolean
  /** Runs one named automation now; rejects when no runtime is registered for it. */
  runOnce(automationId: string, request?: SessionRequest): Promise<void>
  /** Epoch timestamp of that automation's next scheduled session, or null if not running. */
  nextRunAt(automationId: string): number | null
}

/** Enough to cover a night of scheduled blocks; the console has the rest. */
const DIAGNOSTICS_CAPACITY = 200

export interface AppContext {
  /** What the main process complained about lately, for the log screen. */
  readonly diagnostics: DiagnosticsLog
  readonly db: AppDatabase
  readonly settings: SettingsRepo
  readonly repos: AppRepos
  readonly bridge: BridgeServer
  /** Optional PostgreSQL collection context; legacy automation remains usable without it. */
  readonly collection: OptionalCollectionContext
  /** Starts and stops one collection walk; the loop decides when scheduled ones happen. */
  readonly collectionRunner: CollectionRunner
  /** Starts and stops one member collection walk; the loop decides when scheduled ones happen. */
  readonly memberCollectionRunner: MemberCollectionRunner
  /** The periodic member re-walk, on its own cursor. */
  readonly memberResyncRunner: MemberCollectionRunner
  /** The search backfill past each board's list horizon, one block at a time. */
  readonly boardSearchRunner: BoardSearchRunner
  /** The gap's ids read one by one after the search backfill, one block at a time. */
  readonly articleProbeRunner: ArticleProbeRunner
  /** Re-read after the schedule is saved, so a change takes effect without a restart. */
  readonly collectionLoop: CollectionLoop
  readonly automation: AutomationControl
  /** Rotates the pairing token and clears both persistent and live extension trust. */
  resetExtensionPairing(): string
  /** Result of one automation's most recent session, for the tray and the dashboard. */
  lastOutcome(automationId: string): SessionOutcome | null
  /** Epoch timestamp when that automation's last outcome arrived, or null if it never ran. */
  lastOutcomeAt(automationId: string): number | null
  /** What that automation's running session is doing, or null when none is in flight. */
  sessionProgress(automationId: string): SessionProgress | null
  /** True while any automation has a session in flight; the collection walks yield to it. */
  isAnySessionInFlight(): boolean
  /**
   * Count of greeting targets available at startup, once the bridge connects.
   * Null while not yet counted; a READY or UNAVAILABLE result once obtained.
   */
  getStartupPreview(): StartupPreview | null
  /** Counts what a run on that day would answer, without answering any. */
  previewDay(dayStartMs?: number): Promise<StartupPreview>
  /** Current narrowing preview for the day under preview, or null if none. */
  getDayPreview(): StartupPreview | null
  /** Epoch timestamp when the bridge was last seen up, or null if it never was. */
  lastBridgeConnectedAt(): number | null
  /**
   * The last read taken purely to keep the browser's naver login in use. Null
   * until one lands, which is also what a stopped automation keeps showing.
   */
  lastWarm(): WarmCheck | null
  shutdown(): Promise<void>
}

export async function createAppContext(options: AppContextOptions): Promise<AppContext> {
  const diagnostics = createDiagnosticsLog({ capacity: DIAGNOSTICS_CAPACITY, now: () => systemClock.now() })
  const db = openDatabase(options.databasePath, { migrationsFolder: options.migrationsFolder })
  const settings = createSettingsRepo(db)
  const collection = await openOptionalCollectionContext(
    () => resolveCollectionDatabaseUrl(process.env, options.collectionConfigPath),
    options.collectionMigrationsFolder,
  )
  if (collection.kind === 'unavailable') options.onCollectionUnavailable?.(collection.code)

  let token = settings.get('pairingToken')
  if (token === undefined) {
    token = generateToken()
    settings.set('pairingToken', token)
  }

  const local = options.localConfig ?? null
  if (local !== null) {
    if (local.cafeId !== undefined && settings.get(SETTING_KEYS.cafeId) === undefined) {
      settings.set(SETTING_KEYS.cafeId, local.cafeId)
    }
    if (local.cafeUrlName !== undefined && settings.get(SETTING_KEYS.cafeUrlName) === undefined) {
      settings.set(SETTING_KEYS.cafeUrlName, local.cafeUrlName)
    }
  }

  const automationSettings = createAutomationSettingsRepo(db)
  if (automationSettings.get(WELCOME_AUTOMATION_ID) === undefined) {
    // Disabled by default. An install that starts posting before anyone has
    // reviewed the settings is the accident this design exists to prevent.
    automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: local?.boardId ?? null,
      optionsJson: '{}',
    })
  }

  if (automationSettings.get(PREFIX_REMINDER_AUTOMATION_ID) === undefined) {
    // Disabled by default, and with no board of its own: the reminder reads the
    // whole-cafe list, and which boards it stays off is stored in its options
    // rather than as the single board a greeting watches.
    automationSettings.upsert({
      automationId: PREFIX_REMINDER_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: null,
      optionsJson: '{}',
    })
  }

  const bridge = await createBridgeServer({
    token,
    boundExtensionId: settings.get('boundExtensionId') ?? null,
    port: options.bridgePort,
    onBind: (extensionId) => settings.set('boundExtensionId', extensionId),
  })

  /**
   * Everything that reads the board goes through the gate rather than the
   * bridge, so the banner, the confirmation panel and the session cannot walk
   * it at the same time. The bridge itself stays for what is not a read of the
   * board: pairing state and shutdown.
   */
  const transport = createNaverReadGate(createCollectGate(bridge))

  const repos: AppRepos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings,
    dedupe: createSqliteDedupeStore(db, () => randomUUID()),
  }

  let killed = false
  let startupPreview: StartupPreview | null = null
  let previewMonitorHandle: NodeJS.Timeout | null = null
  let lastBridgeConnectedAt: number | null = null

  /**
   * Read on every use rather than captured at boot: the operator can enter the
   * cafe long after the app started, and a value frozen at startup would keep
   * the tool pointed at nothing until the next restart.
   */
  const configuredSource = (): { cafeId: string; boardId: string } | null => {
    const cafeId = settings.get(SETTING_KEYS.cafeId)
    const boardId = repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.boardId
    if (!isConfigured(cafeId) || !isConfigured(boardId)) return null
    return { cafeId: cafeId.trim(), boardId: boardId.trim() }
  }

  // For narrowing the day preview as lookups land
  let dayPreview: StartupPreview | null = null
  let dayPreviewId = 0
  /**
   * One lookup per cafe, so the startup count and a later day preview share what
   * they learned instead of each paying for the same posts. The board now travels
   * with each ask, so it no longer keys the cache. Repointing the tool at another
   * cafe builds a new one: answers gathered there are not answers about this one.
   */
  let lookupInUse: { readonly key: string; readonly lookup: CommentAuthorLookup } | null = null
  const commentLookupFor = (source: { cafeId: string; boardId: string }): CommentAuthorLookup => {
    const key = source.cafeId
    if (lookupInUse?.key !== key) {
      lookupInUse = {
        key,
        lookup: createCommentAuthorLookup({
          transport,
          cafeId: source.cafeId,
          automationId: WELCOME_AUTOMATION_ID,
          newRequestId: () => randomUUID(),
          random: systemRandom,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        }),
      }
    }
    return lookupInUse.lookup
  }

  const enabledTemplates = () => repos.templates.listEnabled(WELCOME_AUTOMATION_ID)

  /**
   * The comment a run will leave, drawn fresh each time so a template
   * registered mid-run takes effect on the next post.
   */
  const renderWelcomeBody = (candidate: Candidate): RenderOutcome =>
    renderWelcomeComment(enabledTemplates(), systemRandom, candidate)

  /**
   * What the count screens against instead. The two differ on purpose and only
   * here: a run commits to one drawn template, while a count must not depend on
   * a draw it cannot repeat. Every other step of the judgement is the same
   * `screenCandidate` for both.
   */
  const couldRenderWelcomeBody = (candidate: Candidate): RenderOutcome =>
    renderAnyWelcomeComment(enabledTemplates(), candidate)

  /**
   * The browser holds the login, so the automation is only ever as alive as the
   * naver session in it. The schedule stops reaching naver at midnight and the
   * first session of the day is hours later; this is what covers that gap.
   */
  const warmer = createSessionWarmer({
    clock: systemClock,
    random: systemRandom,
    warm: async () => {
      // A closed browser cannot be warmed, and saying so every hour would bury
      // the log in a fact the operator already knows.
      if (!bridge.isConnected()) return null
      // Nothing to keep warm until someone has said which cafe this is.
      const source = configuredSource()
      if (source === null) return null
      const reply = await transport.request(
        { type: 'CHECK_LOGIN', requestId: randomUUID(), source },
        TIMEOUTS.loginCheckMs,
      )
      // Any other reply did not answer the question this was sent to ask, and
      // reporting it as a sighting would date-stamp something never seen.
      return reply.type === 'LOGIN_STATE' ? { loggedIn: reply.loggedIn } : null
    },
    onError: (error) => diagnostics.warn('warm', error),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })

  /**
   * All that differs between one automation and the next: its limits, what it
   * screens against, how it collects, what it posts, and which board its login
   * check reads. Everything else — the loop, the progress bookkeeping, the
   * outcome plumbing — is the same for every automation and lives in the runtime.
   */
  interface RuntimeSpec {
    readonly automationId: string
    readonly limits: Limits
    readonly guards: readonly Guard[]
    readonly collector: (ctx: CollectorContext) => DayCollector
    readonly renderBody: (candidate: Candidate) => RenderOutcome
    readonly hasBody: () => boolean
    readonly loginBoardId: () => string | null
    readonly requiresBoard: boolean
    /** Gathers this runtime's session line and writes it when the session ends. */
    readonly recorder: SessionRecorder
  }

  const makeRecorder = (automationId: string): SessionRecorder =>
    createSessionRecorder({ automationId, path: options.sessionLogPath, now: () => systemClock.now() })

  /**
   * One session at a time, across every automation.
   *
   * The two automations share one browser session, so their pacing only bounds
   * the cafe's view of us if one runs at a time: the 20~60s gap between comments
   * is per session, and two open at once put two streams through the same login,
   * with two comments able to land in the same second. Each loop's own
   * single-flight cannot see the other, and the read gate serialises only the
   * board reads, not the comment lookups or the writes.
   *
   * A queue rather than a refusal. Both schedules aim at the same two instants —
   * the window opening and the midnight settle — so being due together is normal
   * rather than a fault, and the second session's work is still owed.
   *
   * A waiting session reports no progress, because it has not started: the
   * collection walks read that progress to decide whether to yield, and a
   * session queued behind another is not yet touching naver.
   */
  let naverSession: Promise<unknown> = Promise.resolve()
  const oneAtATime = <T>(run: () => Promise<T>): Promise<T> => {
    const next = naverSession.then(run, run)
    // The chain carries on past a session that threw; the caller still gets the
    // rejection, but the sessions queued behind it must not be wedged by it.
    naverSession = next.catch(() => undefined)
    return next
  }

  const runtimes = new Map<string, AutomationRuntime>()
  const buildRuntime = (spec: RuntimeSpec): AutomationRuntime => {
    const runtime: AutomationRuntime = createAutomationRuntime({
      automationId: spec.automationId,
      limits: spec.limits,
      clock: systemClock,
      random: systemRandom,
      runSession: (() => {
        const run = createSessionRunner({
          automationId: spec.automationId,
          profile: options.profile,
          clock: systemClock,
          random: systemRandom,
          transport,
          repos,
          settings,
          isKilled: () => killed,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          newId: () => randomUUID(),
          renderBody: spec.renderBody,
          hasBody: spec.hasBody,
          guards: spec.guards,
          collector: spec.collector,
          settledDayKey: settledDayKeyFor(spec.automationId),
          loginBoardId: spec.loginBoardId,
          requiresBoard: spec.requiresBoard,
          onProgress: (progress) => {
            spec.recorder.observe(progress)
            runtime.reportProgress(progress)
          },
        })
        // Every entry point — the schedule, the settle, and the operator's own
        // run — reaches naver through this one wrapper, so none of them can
        // open a second session alongside another automation's.
        //
        // The mode and the day list belong to the session, so they are reset the
        // moment one opens rather than when the last one's line was written —
        // which is when its turn comes, not when it joined the queue.
        return (request?: SessionRequest) =>
          oneAtATime(() => {
            spec.recorder.begin(request?.mode ?? 'MANUAL')
            return run(request)
          })
      })(),
      // Every session leaves a line, opened or refused: an opened one is what a
      // refusal cannot leave — the read counts and what was done about them — and
      // both share the one file so the day reads in the order sessions closed.
      onOutcome: (outcome, wake) => spec.recorder.complete(outcome, wake),
      onError: (error) => diagnostics.error(`session:${spec.automationId}`, error),
      onHalt: (reason) => {
        diagnostics.warn(`session:${spec.automationId}`, `halted: ${reason}`)
        // Login is cafe-wide: one runtime finding it gone means every runtime's
        // next session would too, so they all stop rather than take turns
        // rediscovering the same logout.
        for (const other of runtimes.values()) other.stop()
        warmer.stop()
        options.onHalt?.(reason)
      },
      setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    })
    runtimes.set(spec.automationId, runtime)
    return runtime
  }

  buildRuntime({
    automationId: WELCOME_AUTOMATION_ID,
    limits: PROFILES[options.profile],
    guards: WELCOME_GUARDS,
    collector: (ctx) =>
      createWelcomeDayCollector({
        transport,
        automationId: WELCOME_AUTOMATION_ID,
        source: { cafeId: ctx.cafeId, boardId: ctx.boardId ?? '' },
        newRequestId: () => randomUUID(),
      }),
    renderBody: renderWelcomeBody,
    hasBody: () => enabledTemplates().length > 0,
    loginBoardId: () => null,
    requiresBoard: true,
    recorder: makeRecorder(WELCOME_AUTOMATION_ID),
  })

  /**
   * Read fresh on every use, like the greeting's templates: an operator editing
   * the wording or the excluded boards mid-run takes effect on the next session
   * rather than at the next restart.
   */
  const prefixOptions = () =>
    parsePrefixReminderOptions(
      repos.automationSettings.get(PREFIX_REMINDER_AUTOMATION_ID)?.optionsJson ?? '{}',
    )

  // Created ahead of the runtime so the collector can report each day's tally
  // into the same recorder the runtime writes the session line from.
  const prefixRecorder = makeRecorder(PREFIX_REMINDER_AUTOMATION_ID)
  buildRuntime({
    automationId: PREFIX_REMINDER_AUTOMATION_ID,
    limits: { ...PROFILES[options.profile], ...PREFIX_REMINDER_LIMITS[options.profile] },
    guards: PREFIX_REMINDER_GUARDS,
    collector: (ctx) =>
      createTodayArticleCollector({
        fetcher: createBoardPageFetcher(transport, () => randomUUID(), CAFE_ARTICLE_LIST.menuId),
        rules: {
          excludedBoardIds: new Set(prefixOptions().excludedBoardIds),
          operatorAccounts: ctx.operatorAccounts,
        },
        random: systemRandom,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onTally: prefixRecorder.recordTally,
      }),
    renderBody: (candidate) => {
      const options = prefixOptions()
      return renderPrefixReminder(options.commentText, options.nicknameFallback, candidate)
    },
    // Asked once per session, with no post in hand, so it answers only whether
    // the operator has registered any wording at all — the same question the
    // greeting's template count answers. Rendering it here would refuse the
    // whole session with NO_TEMPLATE the moment the wording names a nickname,
    // because there is no candidate yet to read one from. Whether a particular
    // post can be filled in belongs to renderBody, which has the post.
    hasBody: () => prefixOptions().commentText.trim() !== '',
    // Login is cafe-wide, so it is read where the first automation stores it
    // rather than from a board this one does not have.
    loginBoardId: () => repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.boardId ?? null,
    requiresBoard: false,
    recorder: prefixRecorder,
  })

  // Adding a catalogue entry without building its runtime above fails the boot,
  // which is the point: the seam where a second automation's runtime gets wired
  // is visible in the code rather than left to a developer's memory.
  assertRuntimesRegistered([...runtimes.keys()])

  /**
   * The collection walks yield to any greeting session in flight: a session has
   * a person waiting on it, where a backfill has hours to spare.
   */
  const isAnySessionInFlight = (): boolean =>
    [...runtimes.values()].some((runtime) => runtime.sessionProgress() !== null)

  /**
   * The collection walks the board through the same gate the greeting session
   * uses, and yields to it: a session in flight has a person waiting on it,
   * where a backfill has hours to spare.
   */
  const collectionLock = createCollectionLock()

  const collectionRunner = createCollectionRunner({
    repository: () => (collection.kind === 'ready' ? collection.repository : null),
    transport,
    clock: systemClock,
    random: systemRandom,
    pacing: () => readCollectionPacing(settings),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: isAnySessionInFlight,
    lock: collectionLock,
    newId: () => randomUUID(),
    onError: (error) => diagnostics.error('collection', error),
  })

  // Two walks over the member list, told apart only by the cursor their
  // repository advances: the first walk and top-up on the feed's, the
  // periodic re-walk on its own. They share the lock with the board walk.
  const createMemberRunner = (repository: () => MemberWalkRepository | null): MemberCollectionRunner =>
    createMemberCollectionRunner({
      repository,
      transport,
      clock: systemClock,
      random: systemRandom,
      pacing: () => readCollectionPacing(settings),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      isSessionBusy: isAnySessionInFlight,
      lock: collectionLock,
      newId: () => randomUUID(),
      onError: (error) => {
        // Only the fields `safeMemberErrorFields` allows: a failing query's own
        // message quotes the member rows it was inserting.
        if (error instanceof Error) diagnostics.error('member-collection', safeMemberErrorFields(error))
        else diagnostics.error('member-collection', 'non-Error thrown')
      },
    })
  const memberCollectionRunner = createMemberRunner(() => (collection.kind === 'ready' ? collection.memberRepository : null))
  const memberResyncRunner = createMemberRunner(() => (collection.kind === 'ready' ? collection.memberResyncRepository : null))

  // The search backfill takes the same lock and the same read gate as the
  // list walk: one browser session, one walk at a time.
  const boardSearchRunner = createBoardSearchRunner({
    repository: () => (collection.kind === 'ready' ? collection.boardSearchRepository : null),
    fetcher: createBoardSearchPageFetcher(transport, () => randomUUID()),
    isConnected: () => transport.isConnected(),
    clock: systemClock,
    random: systemRandom,
    pacing: () => readCollectionPacing(settings),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: isAnySessionInFlight,
    lock: collectionLock,
    newId: () => randomUUID(),
    onError: (error) => diagnostics.error('board-search', error),
  })

  // Reading ids one by one takes the same lock and read gate: one browser
  // session, one walk at a time.
  const articleProbeRunner = createArticleProbeRunner({
    repository: () => (collection.kind === 'ready' ? collection.articleProbeRepository : null),
    fetcher: createArticleFetcher(transport, () => randomUUID()),
    isConnected: () => transport.isConnected(),
    clock: systemClock,
    random: systemRandom,
    pacing: () => readCollectionPacing(settings),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isSessionBusy: isAnySessionInFlight,
    lock: collectionLock,
    newId: () => randomUUID(),
    onError: (error) => diagnostics.error('article-probe', error),
  })

  const collectionLoop = createCollectionLoop({
    schedule: () => readCollectionSchedule(settings),
    pacing: () => readCollectionPacing(settings),
    jobs: () => [
      createArticleCollectionJob({
        repository: () => (collection.kind === 'ready' ? collection.repository : null),
        runner: collectionRunner,
      }),
      createMemberCollectionJob({
        repository: () => (collection.kind === 'ready' ? collection.memberRepository : null),
        runner: memberCollectionRunner,
      }),
      createMemberResyncJob({
        feed: () => (collection.kind === 'ready' ? collection.memberRepository : null),
        resync: () => (collection.kind === 'ready' ? collection.memberResyncRepository : null),
        runner: memberResyncRunner,
        intervalDays: () => readMemberResyncInterval(settings),
        now: () => systemClock.now(),
      }),
      createBoardSearchJob({
        repository: () => (collection.kind === 'ready' ? collection.boardSearchRepository : null),
        runner: boardSearchRunner,
      }),
      createArticleProbeJob({
        repository: () => (collection.kind === 'ready' ? collection.articleProbeRepository : null),
        search: () => (collection.kind === 'ready' ? collection.boardSearchRepository : null),
        runner: articleProbeRunner,
      }),
    ],
    clock: systemClock,
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    onStarted: (result, scheduledFor) => {
      if (result.kind === 'refused') {
        diagnostics.warn('collection', `scheduled run refused: ${result.reason} ${stamp(scheduledFor)}`)
      }
    },
  })
  collectionLoop.refresh()

  const automation: AutomationControl = {
    start() {
      killed = false
      for (const runtime of runtimes.values()) runtime.start()
      warmer.start()
    },
    stop() {
      for (const runtime of runtimes.values()) runtime.stop()
      warmer.stop()
    },
    kill() {
      killed = true
      for (const runtime of runtimes.values()) runtime.stop()
      warmer.stop()
    },
    isRunning: () => [...runtimes.values()].some((runtime) => runtime.isRunning()),
    nextRunAt: (automationId) => runtimes.get(automationId)?.nextRunAt() ?? null,
    runOnce: (automationId, request) =>
      runtimes.get(automationId)?.runOnce(request) ??
      Promise.reject(new Error(`no runtime: ${automationId}`)),
  }

  /**
   * Polls rather than listening because `onBind` fires only on an extension's
   * first ever pairing — after a restart the extension is already bound and no
   * event arrives. A second is soon enough for a banner, and the MV3 service
   * worker cycles often enough that a live extension is seen almost at once.
   */
  const PREVIEW_POLL_MS = 1_000

  const startPreviewMonitor = (): void => {
    previewMonitorHandle = setInterval(() => {
      if (bridge.isConnected() && startupPreview === null) {
        // Clear the monitor first to ensure we never run again
        if (previewMonitorHandle !== null) {
          clearInterval(previewMonitorHandle)
          previewMonitorHandle = null
        }

        const operatorAccounts = parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts))
        const automationSetting = repos.automationSettings.get(WELCOME_AUTOMATION_ID)
        const source = configuredSource()

        // Counting needs a board to count on. Saying so beats a banner that
        // reports a read failure the operator cannot act on.
        if (source === null) {
          startupPreview = { kind: 'UNAVAILABLE', reason: 'NOT_CONFIGURED' }
          return
        }

        // Run the preview asynchronously; don't block the monitor loop
        const startupId = ++dayPreviewId
        void previewDay({
          transport,
          cafeId: source.cafeId,
          collectDay: createWelcomeDayCollector({
            transport,
            automationId: WELCOME_AUTOMATION_ID,
            source: { cafeId: source.cafeId, boardId: source.boardId },
            newRequestId: () => randomUUID(),
          }),
          automationId: WELCOME_AUTOMATION_ID,
          nowMs: systemClock.now(),
          newRequestId: () => randomUUID(),
          operatorAccounts,
          policy: automationSetting?.policy ?? 'AUTO',
          guards: WELCOME_GUARDS,
          renderBody: couldRenderWelcomeBody,
          // main's per-source lookup, not the single shared one this branch
          // was written against: the screening still takes resolved authors as
          // facts, so which lookup resolved them is the caller's business.
          lookup: commentLookupFor(source),
          onNarrow: (progress) => {
            // Only update dayPreview if this is still the current preview
            if (dayPreviewId === startupId) {
              dayPreview = progress
            }
          },
        }).then((result) => {
          startupPreview = result
        }).catch((error) => {
          diagnostics.error('startup-preview', error)
          startupPreview = { kind: 'UNAVAILABLE', reason: 'READ_FAILED' }
        })
      }
    }, PREVIEW_POLL_MS)
  }

  // Start monitoring after bridge is initialized
  startPreviewMonitor()

  /**
   * Marks the bridge every second it is up, so a later teardown can be measured
   * from the last sighting. Recording only the first pairing would freeze the
   * mark at app start: an hour later every ordinary service worker cycle reads
   * as an hour of silence, and a live extension is reported as offline.
   */
  const BRIDGE_SAMPLE_MS = 1_000

  let monitorConnectionHandle: NodeJS.Timeout | null = null
  const startBridgeMonitor = (): void => {
    monitorConnectionHandle = setInterval(() => {
      if (bridge.isConnected()) lastBridgeConnectedAt = systemClock.now()
    }, BRIDGE_SAMPLE_MS)
  }
  startBridgeMonitor()

  return {
    diagnostics,
    db,
    settings,
    repos,
    bridge,
    collection,
    collectionRunner,
    memberCollectionRunner,
    memberResyncRunner,
    boardSearchRunner,
    articleProbeRunner,
    collectionLoop,
    automation,
    resetExtensionPairing() {
      const nextToken = generateToken()
      db.transaction(() => {
        settings.set('pairingToken', nextToken)
        settings.remove('boundExtensionId')
      })
      bridge.resetPairing(nextToken)
      return nextToken
    },
    lastOutcome: (automationId) => runtimes.get(automationId)?.lastOutcome() ?? null,
    lastOutcomeAt: (automationId) => runtimes.get(automationId)?.lastOutcomeAt() ?? null,
    sessionProgress: (automationId) => runtimes.get(automationId)?.sessionProgress() ?? null,
    isAnySessionInFlight,
    getStartupPreview: () => startupPreview,
    previewDay: (dayStartMs?) => {
      const source = configuredSource()
      if (source === null) {
        return Promise.resolve<StartupPreview>({ kind: 'UNAVAILABLE', reason: 'NOT_CONFIGURED' })
      }
      const id = ++dayPreviewId
      return previewDay({
        transport,
        cafeId: source.cafeId,
        collectDay: createWelcomeDayCollector({
          transport,
          automationId: WELCOME_AUTOMATION_ID,
          source: { cafeId: source.cafeId, boardId: source.boardId },
          newRequestId: () => randomUUID(),
        }),
        automationId: WELCOME_AUTOMATION_ID,
        nowMs: systemClock.now(),
        newRequestId: () => randomUUID(),
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
        policy: repos.automationSettings.get(WELCOME_AUTOMATION_ID)?.policy ?? 'AUTO',
        guards: WELCOME_GUARDS,
        renderBody: couldRenderWelcomeBody,
        ...(dayStartMs !== undefined ? { dayStartMs } : {}),
        lookup: commentLookupFor(source),
        onNarrow: (progress) => {
          if (dayPreviewId === id) {
            dayPreview = progress
          }
        },
      })
    },
    getDayPreview: () => dayPreview,
    lastBridgeConnectedAt: () => lastBridgeConnectedAt,
    lastWarm: () => warmer.lastCheck(),
    async shutdown() {
      if (previewMonitorHandle !== null) {
        clearInterval(previewMonitorHandle)
      }
      if (monitorConnectionHandle !== null) {
        clearInterval(monitorConnectionHandle)
      }
      for (const runtime of runtimes.values()) runtime.stop()
      collectionLoop.stop()
      // A walk in flight is asked to end at its page boundary; the page it is
      // on is either committed whole or dropped whole, never half.
      collectionRunner.stop()
      memberCollectionRunner.stop()
      memberResyncRunner.stop()
      boardSearchRunner.stop()
      articleProbeRunner.stop()
      warmer.stop()
      await bridge.close()
      await collection.close()
    },
  }
}
