import type { AutomationSettingsView } from '../../../desktop/ipc.js'
import type { SettingsSectionKey } from '../../../shared/automations/catalog.js'
import { PrefixReminderSection } from './PrefixReminderSection.js'
import { WelcomeBoardSection } from './WelcomeBoardSection.js'

export interface SectionProps {
  readonly automationId: string
  readonly settings: AutomationSettingsView
}

/**
 * Each automation's own part of the settings panel, by the key its catalogue
 * entry names. A `Record` rather than a branch on the id: a new automation adds
 * a key and a component, and forgetting the component fails the build instead
 * of drawing an empty panel.
 */
export const SETTINGS_SECTIONS: Record<SettingsSectionKey, (props: SectionProps) => React.JSX.Element> = {
  welcomeBoard: WelcomeBoardSection,
  prefixReminder: PrefixReminderSection,
}
