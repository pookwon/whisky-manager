/**
 * Runs `tick` now and again `periodMs` after each run settles, until stopped.
 *
 * The wait starts when a run ends, not when it began: a fixed interval keeps
 * firing while the main process is slow to answer, and every unanswered poll
 * adds more work to the queue that is already behind — the slower it gets,
 * the more it is asked.
 *
 * Reporting a failed run is the tick's own business; the loop only makes sure
 * one failure does not end the polling.
 */
export function startPolling(tick: () => Promise<unknown>, periodMs: number): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const run = (): void => {
    timer = null
    const scheduleNext = (): void => {
      if (!stopped) timer = setTimeout(run, periodMs)
    }
    // A tick that throws before it returns a promise never reaches its own
    // error handling, so it is logged here; it is a failed run, not the end of
    // the polling.
    let settled: Promise<unknown>
    try {
      settled = tick()
    } catch (error) {
      console.error(error)
      settled = Promise.reject(error)
    }
    settled.then(scheduleNext, scheduleNext)
  }

  run()
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
  }
}
