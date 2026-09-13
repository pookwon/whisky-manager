import type { DashboardSnapshot } from '../../../desktop/ipc.js'
import { WELCOME_AUTOMATION_ID } from '../../../shared/automations/catalog.js'
import { TEXT } from '../../../shared/text.js'
import { automationName, isRefusalStale, outcomeSummary, progressSummary } from '../../format.js'
import { commentJobState, type JobState } from './quiet.js'

/**
 * One comment job's card, worked out from the snapshot.
 *
 * Every number and every reason comes from the card's own automation. The
 * snapshot's top-level figures are sums across automations, and a card that
 * read them would report the other job's failures, or a refusal the other job
 * had, as its own.
 */
export interface CommentCard {
  readonly automationId: string
  readonly title: string
  /**
   * Whether this card carries the day picker and the startup preview. Both are
   * the welcome automation's: the preview counts greetings waiting for a
   * reply and a chosen day re-reads the greeting board.
   */
  readonly showDayControls: boolean
  readonly state: JobState
  readonly lastOutcomeText: string
  readonly lastOutcomeAt: number | null
  readonly executedToday: number
  readonly succeededToday: number
  readonly failedToday: number
  readonly awaitingApproval: number
  readonly sessionInFlight: boolean
  /** Twenty-four counts, one per KST hour of today. */
  readonly executedByHour: readonly number[]
}

export function commentCards(dashboard: DashboardSnapshot): CommentCard[] {
  return dashboard.automations.map((automation) => {
    const progress =
      automation.sessionProgress === null ? null : progressSummary(automation.sessionProgress)
    return {
      automationId: automation.id,
      title: automationName(automation.id),
      showDayControls: automation.id === WELCOME_AUTOMATION_ID,
      state: commentJobState({
        loopRunning: dashboard.loopRunning,
        automationEnabled: automation.enabled,
        withinActiveHours: dashboard.withinActiveHours,
        activeHourStart: dashboard.activeHourStart,
        activeHourEnd: dashboard.activeHourEnd,
        nextSessionAt: automation.nextSessionAt,
        bridgeStatus: dashboard.bridgeStatus,
        progress,
      }),
      lastOutcomeText: isRefusalStale(automation.lastOutcome, automation.enabled)
        ? TEXT.outcome.neverWithCurrentConfig
        : outcomeSummary(automation.lastOutcome).text,
      lastOutcomeAt: automation.lastOutcomeAt,
      executedToday: automation.executedToday,
      succeededToday: automation.succeededToday,
      failedToday: automation.failedToday,
      awaitingApproval: automation.awaitingApproval,
      sessionInFlight: progress !== null,
      executedByHour: automation.executedByHourToday,
    }
  })
}
