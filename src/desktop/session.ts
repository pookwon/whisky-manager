import { operatorAlreadyCommentedGuard } from '../shared/guards.js'
import type { Clock, Random } from '../shared/ports.js'
import { PROFILES } from '../shared/profiles.js'
import { pickTemplate, renderTemplate } from '../shared/templates.js'
import type { Candidate, Profile } from '../shared/types.js'
import type { AppRepos } from './bootstrap.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import { runSession, type RenderOutcome, type SessionOutcome } from './orchestrator.js'
import type { ExtensionTransport } from './ws/server.js'

export const SETTING_KEYS = {
  cafeId: 'cafeId',
  cafeUrlName: 'cafeUrlName',
  operatorAccounts: 'operatorAccounts',
} as const

/** The whisky/cognac club's 가입인사 board, per the design spec. */
export const DEFAULT_CAFE_ID = '10000000'
export const DEFAULT_BOARD_ID = '5'
/** The cafe's vanity url, which is how a person reaches it. */
export const DEFAULT_CAFE_URL_NAME = 'examplecafe'

const NICKNAME_VARIABLE = '닉네임'

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
export function createSessionRunner(options: SessionRunnerOptions): () => Promise<SessionOutcome> {
  const { automationId, repos, settings } = options

  const cafeId = () => settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID

  return async function run(): Promise<SessionOutcome> {
    const setting = repos.automationSettings.get(automationId)
    const limits = { ...PROFILES[options.profile], ...(setting?.limits ?? {}) }
    const cafe = cafeId()
    // The board belongs to the automation, so a second one can watch its own.
    const board = setting?.boardId ?? DEFAULT_BOARD_ID

    const renderBody = (candidate: Candidate): RenderOutcome => {
      const template = pickTemplate(repos.templates.listEnabled(automationId), options.random)
      if (template === null) return { ok: false, missing: ['template'] }

      const result = renderTemplate(template.body, {
        [NICKNAME_VARIABLE]: candidate.authorNickname ?? '',
      })
      return result.ok
        ? { ok: true, templateId: template.id, body: result.text }
        : { ok: false, missing: result.missing }
    }

    const outcome = await runSession({
      automationId,
      cafeId: cafe,
      boardId: board,
      policy: setting?.policy ?? 'AUTO',
      limits,
      guards: [operatorAlreadyCommentedGuard],
      operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
      clock: options.clock,
      random: options.random,
      transport: options.transport,
      dedupe: repos.dedupe,
      repo: repos.executions,
      renderBody,
      isEnabled: () => setting?.enabled ?? false,
      hasTemplate: () => repos.templates.listEnabled(automationId).length > 0,
      isKilled: options.isKilled,
      sleep: options.sleep,
      newRequestId: options.newId,
      watermark: repos.watermarks.get(automationId, cafe, board),
    })

    if (outcome.opened && outcome.lastProcessedPostId !== null) {
      repos.watermarks.set(
        automationId,
        cafe,
        board,
        outcome.lastProcessedPostId,
        options.clock.now(),
      )
    }

    return outcome
  }
}
