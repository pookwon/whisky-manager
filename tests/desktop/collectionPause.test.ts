import { describe, expect, it } from 'vitest'
import { pauseUnlessStopped } from '../../src/desktop/collectionPause.js'

describe('pauseUnlessStopped', () => {
  it('sleeps the whole delay in slices when nothing stops it', async () => {
    const slices: number[] = []
    const done = await pauseUnlessStopped(2_500, async (ms) => { slices.push(ms) }, () => false)
    expect(done).toBe(true)
    expect(slices).toEqual([1_000, 1_000, 500])
  })

  it('returns within a slice of a stop instead of at the end of the delay', async () => {
    let slept = 0
    let stop = false
    const done = await pauseUnlessStopped(600_000, async () => { slept += 1; if (slept === 2) stop = true }, () => stop)
    expect(done).toBe(false)
    expect(slept).toBe(2)
  })

  it('does not sleep at all for a zero delay', async () => {
    let slept = 0
    expect(await pauseUnlessStopped(0, async () => { slept += 1 }, () => false)).toBe(true)
    expect(slept).toBe(0)
  })
})
