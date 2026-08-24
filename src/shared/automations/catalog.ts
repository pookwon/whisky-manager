/**
 * What the app offers, as data. There is no `Automation` interface and no
 * registry of behaviour here: the 2026-08-22 design spec (§5.1) defers that
 * until a second automation exists, because an interface drawn from one case is
 * usually wrong for the second. This list only says what the sidebar renders
 * and which panels each entry owns.
 */
import type { AutomationLabelKey } from '../text.js'

export type AutomationPanel = 'approvals' | 'templates' | 'settings'

export interface AutomationDescriptor {
  readonly id: string
  readonly labelKey: AutomationLabelKey
  /**
   * Not every automation has every panel — a periodic notice has nothing to
   * approve, a membership approval has no comment template. Keeping this as
   * data is what stops the navigation from assuming they all look alike.
   */
  readonly panels: readonly AutomationPanel[]
}

/**
 * Lives here rather than in `bootstrap.ts` so the renderer can name an
 * automation without importing the main process — that import drags
 * better-sqlite3 and ws into the browser bundle and blanks the window.
 */
export const WELCOME_AUTOMATION_ID = 'welcome-comment'

export const AUTOMATIONS: readonly AutomationDescriptor[] = [
  {
    id: WELCOME_AUTOMATION_ID,
    labelKey: 'welcomeComment',
    panels: ['approvals', 'templates', 'settings'],
  },
]

export function findAutomation(id: string): AutomationDescriptor | undefined {
  return AUTOMATIONS.find((automation) => automation.id === id)
}

/**
 * A menu entry whose automation never runs is worse than no entry at all: the
 * operator sees zero executions and cannot tell "nothing to do" from "not
 * running". Rather than warn about that state in the UI, make it impossible to
 * boot into.
 */
export function assertRuntimesRegistered(registered: readonly string[]): void {
  const missing = AUTOMATIONS.filter((automation) => !registered.includes(automation.id))
  if (missing.length > 0) {
    throw new Error(`automations have no runtime registered: ${missing.map((a) => a.id).join(', ')}`)
  }
}
