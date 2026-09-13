import type { Clock, Random } from '../shared/ports.js'
import type { Limits } from '../shared/types.js'
import type { SessionOutcome, SessionProgress } from './orchestrator.js'
import type { SessionRequest } from './session.js'
import { createSessionLoop, type TimerHandle, type WakeRecord } from './sessionLoop.js'

export interface AutomationRuntimeDeps {
  readonly automationId: string
  /** Profile + automation defaults, before DB overrides. */
  readonly limits: Limits
  readonly clock: Clock
  readonly random: Random
  readonly runSession: (request?: SessionRequest) => Promise<SessionOutcome>
  readonly onOutcome: (outcome: SessionOutcome, wake: WakeRecord | null) => void
  readonly onHalt: (reason: 'NOT_LOGGED_IN' | 'LOGIN_CHECK_FAILED') => void
  readonly onError: (error: unknown) => void
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
}

export interface AutomationRuntime {
  readonly automationId: string
  start(): void
  stop(): void
  isRunning(): boolean
  nextRunAt(): number | null
  runOnce(request?: SessionRequest): Promise<void>
  lastOutcome(): SessionOutcome | null
  lastOutcomeAt(): number | null
  sessionProgress(): SessionProgress | null
  /** Called by the session runner's onProgress. */
  reportProgress(progress: SessionProgress | null): void
}

/**
 * One automation's loop and the state its screens read. Bootstrap makes one
 * per catalogue entry; nothing here knows which automation it is running.
 */
export function createAutomationRuntime(deps: AutomationRuntimeDeps): AutomationRuntime {
  let lastOutcome: SessionOutcome | null = null
  let lastOutcomeAt: number | null = null
  let progress: SessionProgress | null = null

  const loop = createSessionLoop({
    limits: deps.limits,
    clock: deps.clock,
    random: deps.random,
    runSession: async (request) => {
      // Set before the first await, so the snapshot read right after the press
      // already says the session exists. The session itself has nothing to
      // report until it has logged in and read a page, which is seconds an
      // operator otherwise spends pressing again.
      progress = { phase: 'STARTING' }
      // Progress means something only while a session is in flight; a session
      // that died must not leave the dashboard claiming it is still working.
      try {
        return await deps.runSession(request)
      } finally {
        progress = null
      }
    },
    onOutcome: (outcome, wake) => {
      lastOutcome = outcome
      lastOutcomeAt = deps.clock.now()
      deps.onOutcome(outcome, wake)
    },
    onError: deps.onError,
    onHalt: deps.onHalt,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
  })

  return {
    automationId: deps.automationId,
    start: () => loop.start(),
    stop: () => loop.stop(),
    isRunning: () => loop.isRunning(),
    nextRunAt: () => loop.nextRunAt(),
    runOnce: (request) => loop.runOnce(request),
    lastOutcome: () => lastOutcome,
    lastOutcomeAt: () => lastOutcomeAt,
    sessionProgress: () => progress,
    reportProgress: (next) => {
      progress = next
    },
  }
}
