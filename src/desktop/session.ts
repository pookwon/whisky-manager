import { WELCOME_GUARDS } from '../shared/automations/welcome-comment/guards.js'
import type { Clock, Random } from '../shared/ports.js'
import { PROFILES } from '../shared/profiles.js'
import type { RenderOutcome } from '../shared/templates.js'
import { kstDayStartMs } from '../shared/kst.js'
import type { Candidate, Profile, RunMode } from '../shared/types.js'
import type { AppRepos } from './bootstrap.js'
import { createCommentAuthorLookup } from './commentAuthors.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import { runSession, type SessionOutcome, type SessionProgress } from './orchestrator.js'
import type { ExtensionTransport } from './ws/server.js'

export const SETTING_KEYS = {
  cafeId: 'cafeId',
  cafeUrlName: 'cafeUrlName',
  operatorAccounts: 'operatorAccounts',
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
  /** Reports what the run is doing. */
  readonly onProgress?: (progress: SessionProgress) => void
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
    // The board belongs to the automation, so a second one can watch its own.
    const board = setting?.boardId

    // Refusing here beats reaching for naver with a blank id: the operator gets
    // a reason on the screen rather than a read that fails for reasons of its own.
    if (!isConfigured(cafe) || !isConfigured(board)) {
      return { opened: false, reason: 'NOT_CONFIGURED' }
    }

    const commentAuthors = createCommentAuthorLookup({
      transport: options.transport,
      cafeId: cafe.trim(),
      boardId: board.trim(),
      automationId,
      newRequestId: options.newId,
      random: options.random,
      sleep: options.sleep,
    })

    const outcome = await runSession({
      automationId,
      cafeId: cafe.trim(),
      boardId: board.trim(),
      policy: setting?.policy ?? 'AUTO',
      limits,
      guards: WELCOME_GUARDS,
      operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
      clock: options.clock,
      random: options.random,
      transport: options.transport,
      dedupe: repos.dedupe,
      repo: repos.executions,
      renderBody: options.renderBody,
      isEnabled: () => setting?.enabled ?? false,
      hasTemplate: () => repos.templates.listEnabled(automationId).length > 0,
      isKilled: options.isKilled,
      sleep: options.sleep,
      newRequestId: options.newId,
      commentAuthors,
      runMode: mode,
      ...(dayStartMs === undefined ? {} : { dayStartMs }),
      // An absent reporter has to be absent rather than undefined here.
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    })

    return outcome
  }
}
