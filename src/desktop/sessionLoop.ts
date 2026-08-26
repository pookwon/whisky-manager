import type { Clock, Random } from '../shared/ports.js'
import { nextSessionStart } from '../shared/schedule.js'
import type { Limits } from '../shared/types.js'
import type { SessionRequest } from './session.js'
import type { SessionOutcome } from './orchestrator.js'

export type TimerHandle = number

/**
 * What the schedule aimed at, and what the clock read when the timer fired.
 *
 * The two are supposed to be the same instant, give or take the milliseconds a
 * timer is allowed. They travel with the outcome because a session refused for
 * being outside the window it was aimed at the opening of cannot be explained
 * from either one alone.
 */
export interface WakeRecord {
  readonly scheduledFor: number
  readonly wokeAt: number
}

export interface SessionLoopDeps {
  readonly limits: Limits
  readonly clock: Clock
  readonly random: Random
  readonly runSession: (request?: SessionRequest) => Promise<SessionOutcome>
  /** `wake` is null for a run nothing scheduled — an operator's, say. */
  readonly onOutcome: (outcome: SessionOutcome, wake: WakeRecord | null) => void
  readonly onError?: (error: unknown) => void
  /** Called when the loop stops itself. The operator has to intervene. */
  readonly onHalt?: (reason: 'NOT_LOGGED_IN' | 'LOGIN_CHECK_FAILED') => void
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
}

export interface SessionLoop {
  start(): void
  stop(): void
  isRunning(): boolean
  runOnce(request?: SessionRequest): Promise<void>
  /**
   * Returns the epoch timestamp of the next scheduled session, or null if the
   * loop is not running. This lets the renderer show when the next session is
   * due without needing to duplicate the scheduling logic.
   */
  nextRunAt(): number | null
}

/** Consecutive login-check failures tolerated before halting. */
const LOGIN_FAILURE_LIMIT = 3

/**
 * Owns the cadence. The extension has no business timer, so everything about
 * when work happens lives here and a torn-down service worker loses nothing.
 */
export function createSessionLoop(deps: SessionLoopDeps): SessionLoop {
  let timer: TimerHandle | null = null
  let running = false
  let loginFailureStreak = 0
  let nextScheduledAt: number | null = null

  function stopAll(): void {
    running = false
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    nextScheduledAt = null
  }

  /**
   * Being logged out is unrecoverable without a human, so it halts at once. A
   * failed check is not the same thing — a flaky network should cost one
   * session, not the whole automation — so it only halts on a streak.
   */
  function reactTo(outcome: SessionOutcome): void {
    if (outcome.opened) {
      loginFailureStreak = 0
      return
    }
    if (outcome.reason === 'NOT_LOGGED_IN') {
      stopAll()
      deps.onHalt?.('NOT_LOGGED_IN')
      return
    }
    if (outcome.reason === 'LOGIN_CHECK_FAILED') {
      loginFailureStreak += 1
      if (loginFailureStreak >= LOGIN_FAILURE_LIMIT) {
        loginFailureStreak = 0
        stopAll()
        deps.onHalt?.('LOGIN_CHECK_FAILED')
      }
      return
    }
    loginFailureStreak = 0
  }

  /**
   * Single-flight: a manual "run now" while a scheduled session is mid-flight
   * joins that session instead of starting a second one. Two concurrent
   * sessions would both pick up the same queued backlog rows.
   */
  let inFlight: Promise<void> | null = null

  function runOnceInternal(request: SessionRequest, wake: WakeRecord | null = null): Promise<void> {
    if (inFlight !== null) return inFlight
    inFlight = (async () => {
      try {
        const outcome = await deps.runSession(request)
        reactTo(outcome)
        deps.onOutcome(outcome, wake)
      } catch (error) {
        deps.onError?.(error)
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  function schedule(): void {
    const now = deps.clock.now()
    const at = nextSessionStart(now, deps.limits, deps.clock, deps.random)
    nextScheduledAt = at
    timer = deps.setTimer(() => {
      // The handle is spent the moment it fires, and the session it starts
      // outlives it by the better part of an hour. Letting go of it here is
      // what tells stop() there is nothing left to cancel, and what lets the
      // session below tell a schedule it still owns from one that a restart
      // has already replaced.
      timer = null
      const wake: WakeRecord = { scheduledFor: at, wokeAt: deps.clock.now() }
      void runOnceInternal({ mode: 'SCHEDULED' }, wake).finally(() => {
        // Stopping mid-session means stopped: the operator's switch outranks a
        // session that was already under way. A restart inside that same
        // session has already laid the next beat, and the session must not add
        // a second one on top — two live timers run the loop twice as often as
        // asked, and stopping only ever clears the newer of them.
        if (running && timer === null) schedule()
      })
    }, Math.max(0, at - now))
  }

  return {
    start() {
      if (running) return
      running = true
      schedule()
    },

    stop() {
      stopAll()
    },

    isRunning() {
      return running
    },

    nextRunAt() {
      return nextScheduledAt
    },

    runOnce(request = {}) {
      return runOnceInternal(request)
    },
  }
}
