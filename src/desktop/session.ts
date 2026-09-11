import { WELCOME_AUTOMATION_ID } from '../shared/automations/catalog.js'
import type { Guard } from '../shared/guards.js'
import type { Clock, Random } from '../shared/ports.js'
import { PROFILES } from '../shared/profiles.js'
import type { RenderOutcome } from '../shared/templates.js'
import { kstDayStartMs } from '../shared/kst.js'
import type { Candidate, Profile, RunMode } from '../shared/types.js'
import type { AppRepos } from './bootstrap.js'
import type { DayCollector } from './collection.js'
import { createCommentAuthorLookup } from './commentAuthors.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import { runSession, type SessionOutcome, type SessionProgress } from './orchestrator.js'
import type { ExtensionTransport } from './ws/server.js'

export const SETTING_KEYS = {
  cafeId: 'cafeId',
  cafeUrlName: 'cafeUrlName',
  operatorAccounts: 'operatorAccounts',
  /** Midnight KST of the last day worked to its end, as a decimal string. */
  lastSettledDay: 'lastSettledDayStartMs',
} as const

/**
 * Which cafe and which board is the operator's to say, and it is kept out of
 * the source on purpose. A compiled-in default would point every copy of this
 * tool at whichever cafe the author happened to run, and the first launch of a
 * fresh build would reach for a board its operator never chose.
 */
export function isConfigured(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

export interface SessionRunnerOptions {
  readonly automationId: string
  readonly profile: Profile
  readonly clock: Clock
  readonly random: Random
  readonly transport: ExtensionTransport
  readonly repos: AppRepos
  readonly settings: SettingsRepo
  readonly isKilled: () => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly newId: () => string
  /**
   * Renders the comment to post. Supplied by the caller rather than built here
   * so the count shown to the operator beforehand is screened through a
   * renderer wired from the same templates, and the two cannot answer about
   * different comments.
   */
  readonly renderBody: (candidate: Candidate) => RenderOutcome
  /** What every post this automation collects is screened against. */
  readonly guards: readonly Guard[]
  /** Builds the day collector once the cafe and operator accounts are known. */
  readonly collector: (context: CollectorContext) => DayCollector
  /** Settings key holding midnight KST of the last settled day. */
  readonly settledDayKey: string
  /** Board the login check reads. Null falls back to the automation's own boardId setting. */
  readonly loginBoardId: () => string | null
  /** Refuses with NOT_CONFIGURED when false. Welcome needs a board; a cafe-wide automation does not. */
  readonly requiresBoard: boolean
  /** Whether anything is registered to post, so the run can refuse loudly rather than skip in silence. */
  readonly hasBody: () => boolean
  /** Reports what the run is doing. */
  readonly onProgress?: (progress: SessionProgress) => void
}

/** What a collector needs once the operator's configuration has been read. */
export interface CollectorContext {
  readonly cafeId: string
  readonly boardId: string | null
  readonly operatorAccounts: readonly string[]
}

export function settledDayKeyFor(automationId: string): string {
  // The first automation wrote its day under the bare key; keeping that spelling
  // keeps the value.
  return automationId === WELCOME_AUTOMATION_ID
    ? SETTING_KEYS.lastSettledDay
    : `${SETTING_KEYS.lastSettledDay}:${automationId}`
}

/** Operator accounts are stored as a JSON string array in app settings. */
export function parseOperatorAccounts(raw: string | undefined): string[] {
  if (raw === undefined) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * Assembles a session from whatever the operator has configured *right now*.
 * Everything is read per run, so a policy or template change takes effect on
 * the next session without restarting the app.
 */
/** What an operator, or the schedule, is asking a session to do. */
export interface SessionRequest {
  readonly mode?: RunMode
  /** Midnight KST of the day to work. Omitted means the day the session opens. */
  readonly dayStartMs?: number
}

export function createSessionRunner(
  options: SessionRunnerOptions,
): (request?: SessionRequest) => Promise<SessionOutcome> {
  const { automationId, repos, settings } = options

  return async function run(request: SessionRequest = {}): Promise<SessionOutcome> {
    const { mode = 'MANUAL', dayStartMs } = request

    // A day that has not arrived holds no posts, and asking for one is a
    // mistake worth naming rather than a session that quietly finds nothing.
    if (dayStartMs !== undefined && dayStartMs > kstDayStartMs(options.clock.now())) {
      return { opened: false, reason: 'FUTURE_DAY' }
    }

    const setting = repos.automationSettings.get(automationId)
    const limits = { ...PROFILES[options.profile], ...(setting?.limits ?? {}) }
    const cafe = settings.get(SETTING_KEYS.cafeId)
    // The board belongs to the automation, so a second one can watch its own. A
    // caller may name the board the login check reads; falling back keeps the
    // welcome automation reading its own configured board.
    const board = options.loginBoardId() ?? setting?.boardId ?? null

    // Refusing here beats reaching for naver with a blank id: the operator gets
    // a reason on the screen rather than a read that fails for reasons of its own.
    if (!isConfigured(cafe) || (options.requiresBoard && !isConfigured(board))) {
      return { opened: false, reason: 'NOT_CONFIGURED' }
    }

    const operatorAccounts = parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts))

    const commentAuthors = createCommentAuthorLookup({
      transport: options.transport,
      cafeId: cafe.trim(),
      automationId,
      newRequestId: options.newId,
      random: options.random,
      sleep: options.sleep,
    })

    const collectDay = options.collector({
      cafeId: cafe.trim(),
      boardId: board?.trim() ?? null,
      operatorAccounts,
    })

    const outcome = await runSession({
      automationId,
      cafeId: cafe.trim(),
      loginSource: { cafeId: cafe.trim(), boardId: (board ?? '').trim() },
      collectDay,
      policy: setting?.policy ?? 'AUTO',
      limits,
      guards: options.guards,
      operatorAccounts,
      clock: options.clock,
      random: options.random,
      transport: options.transport,
      dedupe: repos.dedupe,
      repo: repos.executions,
      renderBody: options.renderBody,
      isEnabled: () => setting?.enabled ?? false,
      hasTemplate: options.hasBody,
      isKilled: options.isKilled,
      sleep: options.sleep,
      newRequestId: options.newId,
      commentAuthors,
      runMode: mode,
      ...(dayStartMs === undefined ? {} : { dayStartMs }),
      // An absent reporter has to be absent rather than undefined here.
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      lastSettledDay: () => {
        const raw = settings.get(options.settledDayKey)
        if (raw === undefined) return null
        const parsed = Number(raw)
        // A setting that is not a number is a setting nobody can act on. Reading
        // it as null costs one redundant collection; reading it as NaN would
        // make every comparison against it false and settle nothing, ever.
        if (!Number.isFinite(parsed)) return null
        // No day after today can have been settled, so a value later than today
        // is not a day this ever wrote — a hand-edited setting, a clock that has
        // since moved back, a half-written file. It has to be refused rather
        // than believed, because believing it is the one failure this whole
        // branch cannot survive: every day would compare as already settled and
        // the tool would stop settling for good, silently, with the greetings it
        // exists to send simply never going out.
        return parsed > kstDayStartMs(options.clock.now()) ? null : parsed
      },
      onDaySettled: (dayStartMs) => {
        settings.set(options.settledDayKey, String(dayStartMs))
      },
    })

    return outcome
  }
}
