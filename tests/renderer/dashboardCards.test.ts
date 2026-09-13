import { describe, expect, it } from 'vitest'
import type { AutomationStatus, DashboardSnapshot } from '../../src/desktop/ipc.js'
import {
  PREFIX_REMINDER_AUTOMATION_ID,
  WELCOME_AUTOMATION_ID,
} from '../../src/shared/automations/catalog.js'
import { TEXT } from '../../src/shared/text.js'
import { commentCards } from '../../src/renderer/views/dashboard/commentCards.js'

function kst(iso: string): number {
  return Date.parse(`${iso}+09:00`)
}

function status(id: string, overrides: Partial<AutomationStatus> = {}): AutomationStatus {
  return {
    id,
    enabled: true,
    awaitingApproval: 0,
    executedToday: 0,
    succeededToday: 0,
    failedToday: 0,
    lastOutcome: null,
    lastOutcomeAt: null,
    nextSessionAt: null,
    sessionProgress: null,
    executedByHourToday: Array.from({ length: 24 }, () => 0),
    ...overrides,
  }
}

function snapshot(automations: AutomationStatus[]): DashboardSnapshot {
  return {
    loopRunning: true,
    awaitingApproval: 0,
    executedToday: 0,
    succeededToday: 0,
    failedToday: 0,
    lastOutcome: null,
    automations,
    startupPreview: null,
    dayPreview: null,
    lastOutcomeAt: null,
    nextSessionAt: null,
    sessionProgress: null,
    lastWarm: null,
    withinActiveHours: true,
    activeHourStart: 8,
    activeHourEnd: 24,
    averageActionGapMs: 16_500,
    bridgeStatus: 'CONNECTED',
    extensionEverPaired: true,
  }
}

describe('commentCards', () => {
  it("carries each automation's own hours, so one card's bars never show another's sessions", () => {
    const welcomeHours = Array.from({ length: 24 }, (_, hour) => (hour === 10 ? 2 : 0))
    const cards = commentCards(
      snapshot([status(WELCOME_AUTOMATION_ID, { executedByHourToday: welcomeHours }), status(PREFIX_REMINDER_AUTOMATION_ID)]),
    )

    expect(cards[0]?.executedByHour).toBe(welcomeHours)
    expect(cards[1]?.executedByHour.every((n) => n === 0)).toBe(true)
  })

  it('draws one card per automation, in the order the snapshot lists them, named by the catalogue', () => {
    const cards = commentCards(
      snapshot([status(WELCOME_AUTOMATION_ID), status(PREFIX_REMINDER_AUTOMATION_ID)]),
    )

    expect(cards.map((card) => [card.automationId, card.title])).toEqual([
      [WELCOME_AUTOMATION_ID, TEXT.automation.welcomeComment],
      [PREFIX_REMINDER_AUTOMATION_ID, TEXT.automation.prefixReminder],
    ])
  })

  it('keeps the day picker and the startup preview on the welcome card alone', () => {
    // The preview counts greetings and a chosen day re-reads the greeting
    // board; neither means anything for the reminder.
    const cards = commentCards(
      snapshot([status(WELCOME_AUTOMATION_ID), status(PREFIX_REMINDER_AUTOMATION_ID)]),
    )

    expect(cards.map((card) => card.showDayControls)).toEqual([true, false])
  })

  it('says each automation is off on its own card, not on its neighbour', () => {
    // One switch off must not read as both jobs being off, and the card whose
    // switch is on must not claim the other's reason.
    const [welcome, reminder] = commentCards(
      snapshot([
        status(WELCOME_AUTOMATION_ID),
        status(PREFIX_REMINDER_AUTOMATION_ID, { enabled: false }),
      ]),
    )

    expect(welcome?.state.status).toBe(TEXT.dashboard.job.waiting)
    expect(reminder?.state.status).toBe(TEXT.dashboard.job.off)
    expect(reminder?.state.why).toBe(TEXT.dashboard.quiet.sessionDisabled)
  })

  it('reads the next session and the session in flight from the card\'s own automation', () => {
    const [welcome, reminder] = commentCards(
      snapshot([
        status(WELCOME_AUTOMATION_ID, { nextSessionAt: kst('2026-09-11T14:20:00') }),
        status(PREFIX_REMINDER_AUTOMATION_ID, {
          sessionProgress: { phase: 'WORKING', done: 1, total: 4, nickname: null },
        }),
      ]),
    )

    expect(welcome?.state.why).toContain('14:20')
    expect(welcome?.sessionInFlight).toBe(false)
    expect(reminder?.state.status).toBe(TEXT.dashboard.job.running)
    expect(reminder?.state.why).toBe(TEXT.progress.working(2, 4))
    expect(reminder?.sessionInFlight).toBe(true)
  })

  it('reports each automation\'s own last result and today\'s own counts', () => {
    const [welcome, reminder] = commentCards(
      snapshot([
        status(WELCOME_AUTOMATION_ID, {
          executedToday: 3,
          succeededToday: 3,
          lastOutcome: { opened: true, executed: 3, skipped: 0, awaitingApproval: 0, failed: 0 },
          lastOutcomeAt: kst('2026-09-11T13:00:00'),
        }),
        status(PREFIX_REMINDER_AUTOMATION_ID, {
          executedToday: 2,
          failedToday: 1,
          succeededToday: 1,
          awaitingApproval: 4,
          lastOutcome: { opened: false, reason: 'NO_TEMPLATE' },
        }),
      ]),
    )

    expect(welcome).toMatchObject({
      lastOutcomeText: TEXT.outcome.ran(3),
      lastOutcomeAt: kst('2026-09-11T13:00:00'),
      executedToday: 3,
      succeededToday: 3,
      failedToday: 0,
      awaitingApproval: 0,
    })
    expect(reminder).toMatchObject({
      lastOutcomeText: TEXT.outcome.refused.NO_TEMPLATE,
      lastOutcomeAt: null,
      executedToday: 2,
      succeededToday: 1,
      failedToday: 1,
      awaitingApproval: 4,
    })
  })

  it('does not repeat a switched-off refusal once that automation is back on', () => {
    const [reminder] = commentCards(
      snapshot([
        status(PREFIX_REMINDER_AUTOMATION_ID, { lastOutcome: { opened: false, reason: 'DISABLED' } }),
      ]),
    )

    expect(reminder?.lastOutcomeText).toBe(TEXT.outcome.neverWithCurrentConfig)
  })

  it('names an automation the catalogue does not know by its id', () => {
    const [card] = commentCards(snapshot([status('retired-automation')]))

    expect(card?.title).toBe('retired-automation')
  })
})
