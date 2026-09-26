import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startPolling } from '../../src/renderer/poll.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('startPolling', () => {
  it('runs once straight away', () => {
    const run = vi.fn(() => Promise.resolve())

    startPolling(run, 5_000)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs again a period after the previous run settled', async () => {
    const run = vi.fn(() => Promise.resolve())
    startPolling(run, 5_000)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never starts a run while the previous one is still in flight', async () => {
    const slow = deferred()
    const run = vi.fn(() => slow.promise)
    startPolling(run, 5_000)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)

    slow.resolve()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('keeps polling after a failed run', async () => {
    const run = vi.fn(() => Promise.reject(new Error('read failed')))
    startPolling(run, 5_000)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('keeps polling after a run that throws before returning a promise', async () => {
    const run = vi.fn((): Promise<void> => {
      throw new Error('bridge gone')
    })
    startPolling(run, 5_000)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('runs no more once stopped, even when a run settles afterwards', async () => {
    const slow = deferred()
    const run = vi.fn(() => slow.promise)
    const stop = startPolling(run, 5_000)

    stop()
    slow.resolve()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(run).toHaveBeenCalledTimes(1)
  })
})
