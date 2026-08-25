import type { Random } from '../shared/ports.js'
import { nextWarmDelayMs } from '../shared/schedule.js'

export type TimerHandle = number

export interface SessionWarmerDeps {
  readonly random: Random
  /**
   * One authenticated read of the board. What it answers does not matter here
   * — the request itself is the point, because it is what tells naver the
   * browser's login is still in use.
   */
  readonly warm: () => Promise<void>
  readonly onError?: (error: unknown) => void
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
}

export interface SessionWarmer {
  start(): void
  stop(): void
  isRunning(): boolean
}

/**
 * Keeps the browser's naver login from going cold in the gaps between sessions.
 *
 * The tool owns no credentials: every request rides the cookies of the browser
 * the extension lives in, so a login that lapses there takes the automation
 * with it. The schedule reaches naver a handful of times a day inside a window
 * that closes at midnight, so the small hours can pass with nothing going out
 * at all — and the morning can start logged out.
 *
 * Warming is a read, so it is outside the caps: those count what the tool sends
 * the cafe, and this sends nothing.
 */
export function createSessionWarmer(deps: SessionWarmerDeps): SessionWarmer {
  let timer: TimerHandle | null = null
  let running = false

  function schedule(): void {
    timer = deps.setTimer(() => void read(), nextWarmDelayMs(deps.random))
  }

  async function read(): Promise<void> {
    timer = null
    try {
      await deps.warm()
    } catch (error) {
      // One failed read must not end the schedule. A dropped bridge or a closed
      // browser is when the next read matters most, and reporting is all this
      // can usefully do about either.
      deps.onError?.(error)
    }
    // Stopping mid-read means stopped: the operator's switch outranks a read
    // that was already on its way out. A restart inside that same read has
    // already laid the next beat, and a read cannot add a second one on top —
    // two live timers warm naver twice as often as asked, and stopping only
    // ever clears the newer of them.
    if (running && timer === null) schedule()
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
  }
}
