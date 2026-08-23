import { eq } from 'drizzle-orm'
import type { ApprovalPolicy, Limits } from '../../shared/types.js'
import type { AppDatabase } from './client.js'
import { automationSettings } from './schema.js'

export interface AutomationSetting {
  readonly automationId: string
  readonly policy: ApprovalPolicy
  readonly limits: Partial<Limits>
  readonly enabled: boolean
  /** `null` means never configured; the reader falls back to the default board. */
  readonly boardId: string | null
}

export interface AutomationSettingsRepo {
  get(automationId: string): AutomationSetting | undefined
  upsert(setting: AutomationSetting): void
}

function parseLimits(raw: string): Partial<Limits> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Limits>) : {}
  } catch {
    return {}
  }
}

export function createAutomationSettingsRepo(db: AppDatabase): AutomationSettingsRepo {
  return {
    get(automationId) {
      const row = db
        .select()
        .from(automationSettings)
        .where(eq(automationSettings.automationId, automationId))
        .get()
      if (row === undefined) return undefined
      return {
        automationId: row.automationId,
        policy: row.policy as ApprovalPolicy,
        limits: parseLimits(row.limitsJson),
        enabled: row.enabled,
        boardId: row.boardId,
      }
    },
    upsert(setting) {
      const values = {
        automationId: setting.automationId,
        policy: setting.policy,
        limitsJson: JSON.stringify(setting.limits),
        enabled: setting.enabled,
        boardId: setting.boardId,
      }
      db.insert(automationSettings)
        .values(values)
        .onConflictDoUpdate({
          target: automationSettings.automationId,
          set: {
            policy: values.policy,
            limitsJson: values.limitsJson,
            enabled: values.enabled,
            boardId: values.boardId,
          },
        })
        .run()
    },
  }
}
