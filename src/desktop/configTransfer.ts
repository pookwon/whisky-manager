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
  /**
   * How many landed switched on. The screen warns on this rather than assuming:
   * an import that starts posting must say so, and one that lands mute must say
   * that too, or a quiet install reads as a broken one.
   */
  readonly enabledCount: number
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
 * `limits` is the one field a file never reaches: the exporting machine may
 * have been running the debug profile, whose pacing has no business on an
 * operator's install. Everything else is obeyed, the switch included — the
 * operator carried this file over to have the same tool they already set up,
 * and one that lands mute is read as broken rather than as cautious. What that
 * means is not left for them to discover: `enabledCount` goes back so the
 * screen can say, in the same breath, that comments are now able to go out.
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
        enabled: automation.enabled,
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

  return {
    automationCount: known.length,
    templateCount,
    // Counted off `known`: an entry this build has no runtime for is switched
    // on in the file and off in reality, and must not be promised either way.
    enabledCount: known.filter((automation) => automation.enabled).length,
  }
}
