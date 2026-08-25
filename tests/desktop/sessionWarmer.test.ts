import { describe, expect, it, vi } from 'vitest'
import { createSessionWarmer, type SessionWarmerDeps } from '../../src/desktop/sessionWarmer.js'
import { SequenceRandom } from '../fakes.js'

const HOUR_MS = 3_600_000

/** Lets a test fire the warmer's timer instead of waiting out a real hour. */
function manualTimer() {
  const fired: (() => void)[] = []
  return {
    setTimer: vi.fn((fn: () => void, _ms: number) => {
      fired.push(fn)
      return fired.length
    }),
    clearTimer: vi.fn(),
    /** Runs the pending callback and lets the read it starts settle. */
    async fire(): Promise<void> {
      fired.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}

function warmerDeps(overrides: Partial<SessionWarmerDeps> = {}): SessionWarmerDeps {
  return {
    // The middle of the band, so retuning it does not silently clamp here.
    random: new SequenceRandom([HOUR_MS]),
    warm: () => Promise.resolve(),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    ...overrides,
  }
}

describe('createSessionWarmer', () => {
  it('is not running before start', () => {
    expect(createSessionWarmer(warmerDeps()).isRunning()).toBe(false)
  })

  it('reports running after start and stopped after stop', () => {
    const warmer = createSessionWarmer(warmerDeps({ setTimer: () => 1 }))
    warmer.start()
    expect(warmer.isRunning()).toBe(true)
    warmer.stop()
    expect(warmer.isRunning()).toBe(false)
  })

  it('waits out the drawn delay before the first read', () => {
    const timer = manualTimer()
    const warm = vi.fn(() => Promise.resolve())
    const warmer = createSessionWarmer(warmerDeps({ ...timer, warm }))

    warmer.start()

    expect(timer.setTimer).toHaveBeenCalledTimes(1)
    expect(timer.setTimer.mock.calls[0]?.[1]).toBe(HOUR_MS)
    // Starting is not itself a reason to touch naver: the operator has just
    // been in the browser.
    expect(warm).not.toHaveBeenCalled()
    warmer.stop()
  })

  it('reads and schedules the next read when the timer fires', async () => {
    const timer = manualTimer()
    const warm = vi.fn(() => Promise.resolve())
    const warmer = createSessionWarmer(warmerDeps({ ...timer, warm }))

    warmer.start()
    await timer.fire()

    expect(warm).toHaveBeenCalledTimes(1)
    expect(timer.setTimer).toHaveBeenCalledTimes(2)
    warmer.stop()
  })

  it('keeps its schedule after a failed read and reports the failure', async () => {
    const timer = manualTimer()
    const failure = new Error('extension is not connected')
    const onError = vi.fn()
    const warmer = createSessionWarmer(
      warmerDeps({ ...timer, warm: () => Promise.reject(failure), onError }),
    )

    warmer.start()
    await timer.fire()

    expect(onError).toHaveBeenCalledWith(failure)
    // A dropped bridge is exactly when the next read matters most.
    expect(timer.setTimer).toHaveBeenCalledTimes(2)
    warmer.stop()
  })

  it('cancels the pending timer on stop', () => {
    const clearTimer = vi.fn()
    const warmer = createSessionWarmer(warmerDeps({ setTimer: () => 42, clearTimer }))

    warmer.start()
    warmer.stop()

    expect(clearTimer).toHaveBeenCalledWith(42)
  })

  it('is idempotent on repeated start', () => {
    const setTimer = vi.fn(() => 1)
    const warmer = createSessionWarmer(warmerDeps({ setTimer }))

    warmer.start()
    warmer.start()

    expect(setTimer).toHaveBeenCalledTimes(1)
    warmer.stop()
  })

  it('does not double its cadence when restarted during a read', async () => {
    const timer = manualTimer()
    let release = (): void => {}
    const warmer = createSessionWarmer(
      warmerDeps({
        ...timer,
        warm: () => new Promise<void>((resolve) => (release = resolve)),
      }),
    )

    warmer.start()
    const fired = timer.fire()
    warmer.stop()
    // The tray switch is one click; off and on again inside a read is a click
    // apart, not a rare accident.
    warmer.start()
    release()
    await fired

    // The restart owns the schedule now. A read that was already on its way out
    // must not leave a second timer behind it, or naver gets warmed twice an
    // hour and nothing ever clears the extra beat.
    expect(timer.setTimer).toHaveBeenCalledTimes(2)
    warmer.stop()
  })

  it('schedules nothing more when stopped during a read', async () => {
    const timer = manualTimer()
    let release = (): void => {}
    const warmer = createSessionWarmer(
      warmerDeps({
        ...timer,
        warm: () => new Promise<void>((resolve) => (release = resolve)),
      }),
    )

    warmer.start()
    const fired = timer.fire()
    warmer.stop()
    release()
    await fired

    expect(timer.setTimer).toHaveBeenCalledTimes(1)
  })
})
