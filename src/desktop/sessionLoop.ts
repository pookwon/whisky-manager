import type { Clock, Random } from '../shared/ports.js'
import { nextSessionStart } from '../shared/schedule.js'
import type { Limits } from '../shared/types.js'
import type { SessionOutcome } from './orchestrator.js'

export type TimerHandle = number

export interface SessionLoopDeps {
  readonly limits: Limits
  readonly clock: Clock
  readonly random: Random
  readonly runSession: () => Promise<SessionOutcome>
  readonly onOutcome: (outcome: SessionOutcome) => void
  readonly onError?: (error: unknown) => void
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
}

export interface SessionLoop {
  start(): void
  stop(): void
  isRunning(): boolean
  runOnce(): Promise<void>
}

/**
 * Owns the cadence. The extension has no business timer, so everything about
 * when work happens lives here and a torn-down service worker loses nothing.
 */
export function createSessionLoop(deps: SessionLoopDeps): SessionLoop {
  let timer: TimerHandle | null = null
  let running = false

  async function runOnce(): Promise<void> {
    try {
      deps.onOutcome(await deps.runSession())
    } catch (error) {
      deps.onError?.(error)
    }
  }

  function schedule(): void {
    const now = deps.clock.now()
    const at = nextSessionStart(now, deps.limits, deps.clock, deps.random)
    timer = deps.setTimer(() => {
      void runOnce().finally(() => {
        if (running) schedule()
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
      running = false
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
    },

    isRunning() {
      return running
    },

    runOnce,
  }
}
