import { AUTOMATIONS, findAutomation } from '../shared/automations/catalog.js'
import {
  CONFIG_BUNDLE_VERSION,
  type BundleAutomation,
  type ConfigBundle,
} from '../shared/configBundle.js'
import type { AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import type { TemplatesRepo } from './db/templatesRepo.js'
import { SETTING_KEYS, parseOperatorAccounts } from './session.js'

/**
 * Moving a configuration between installs, in terms of repositories alone.
 *
 * Nothing here opens a file or a dialog. What a bundle *is* belongs to
 * `shared/configBundle`, where it can be judged without a database; where it
 * comes from and goes to belongs to the shell. This module is only the part
 * that knows which rows make up "the settings" — and, just as much, which ones
 * do not.
 */

export interface ConfigTransferDeps {
  readonly settings: SettingsRepo
  readonly templates: TemplatesRepo
  readonly automationSettings: AutomationSettingsRepo
  /**
   * Runs the writes as one unit. An import that died half-way would leave a
   * cafe from the file beside templates from before it — a configuration
   * neither machine has ever had, and one nobody would think to look for.
   */
  readonly transaction: (run: () => void) => void
  readonly now: () => number
  readonly newId: () => string
}

/** What an import actually changed, for the sentence the operator reads after. */
export interface ImportSummary {
  readonly automationCount: number
  readonly templateCount: number
}

/**
 * Reads the current configuration out into a bundle.
 *
 * The three app-settings keys are named one by one rather than swept out of
 * the table, and that is the whole safeguard against the pairing token
 * travelling with them: a secret can only leave here by someone writing its
 * name below.
 */
export function buildBundle(deps: ConfigTransferDeps): ConfigBundle {
  const automations = AUTOMATIONS.map((automation): BundleAutomation => {
    const setting = deps.automationSettings.get(automation.id)
    return {
      id: automation.id,
      policy: setting?.policy ?? 'AUTO',
      boardId: setting?.boardId ?? '',
      enabled: setting?.enabled ?? false,
      templates: deps.templates
        .listAll(automation.id)
        .map((template) => ({ body: template.body, enabled: template.enabled })),
    }
  })

  return {
    version: CONFIG_BUNDLE_VERSION,
    exportedAt: deps.now(),
    common: {
      cafeId: deps.settings.get(SETTING_KEYS.cafeId) ?? '',
      cafeUrlName: deps.settings.get(SETTING_KEYS.cafeUrlName) ?? '',
      operatorAccounts: parseOperatorAccounts(deps.settings.get(SETTING_KEYS.operatorAccounts)),
    },
    automations,
  }
}

/**
 * Writes a bundle over the current configuration.
 *
 * Two fields the file carries are not obeyed. `enabled` is forced off, because
 * an install that starts posting before anyone has looked at what just landed
 * is the accident a fresh database is already protected from, and an import
 * must not be the way around it. `limits` is never read from a file at all —
 * the exporting machine may have been running the debug profile, whose pacing
 * has no business on an operator's install.
 */
export function applyBundle(deps: ConfigTransferDeps, bundle: ConfigBundle): ImportSummary {
  // A file may name an automation this build has never heard of — a newer
  // export, or one edited by hand. Writing that row would leave settings
  // nothing reads and count them as applied.
  const known = bundle.automations.filter((automation) => findAutomation(automation.id) !== undefined)
  const importedAt = deps.now()
  let templateCount = 0

  deps.transaction(() => {
    deps.settings.set(SETTING_KEYS.cafeId, bundle.common.cafeId)
    deps.settings.set(SETTING_KEYS.cafeUrlName, bundle.common.cafeUrlName)
    deps.settings.set(SETTING_KEYS.operatorAccounts, JSON.stringify(bundle.common.operatorAccounts))

    for (const automation of known) {
      deps.automationSettings.upsert({
        automationId: automation.id,
        policy: automation.policy,
        limits: deps.automationSettings.get(automation.id)?.limits ?? {},
        enabled: false,
        boardId: automation.boardId === '' ? null : automation.boardId,
      })

      deps.templates.replaceAll(
        automation.id,
        automation.templates.map((template, index) => ({
          id: deps.newId(),
          body: template.body,
          enabled: template.enabled,
          // createdAt is read for ordering and nothing else, so the file's
          // order is preserved by spacing rather than by carrying another
          // machine's clock into this database.
          createdAt: importedAt + index,
        })),
      )
      templateCount += automation.templates.length
    }
  })

  return { automationCount: known.length, templateCount }
}
