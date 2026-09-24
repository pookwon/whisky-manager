import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLLECTION_PACING,
  MAX_BREAK_SECONDS,
  MIN_PAGE_DELAY_SECONDS,
  collectionDelayMs,
  normalizeCollectionPacing,
  pagesPerWorkBlock,
  type CollectionPacing,
} from '../../src/shared/collectionPacing.js'

const lowest = { intInclusive: (min: number) => min }
const highest = { intInclusive: (_min: number, max: number) => max }

/** The pacing the app shipped with before it became a setting. */
const FORMER: CollectionPacing = {
  perPage: { minSeconds: 5, maxSeconds: 9 },
  everyTwentyPages: { minSeconds: 120, maxSeconds: 300 },
  everyHundredPages: { minSeconds: 600, maxSeconds: 1_200 },
}

describe('collection pacing', () => {
  it('waits nothing before the first read and adds the short and long breaks on their ordinals', () => {
    expect(collectionDelayMs(1, DEFAULT_COLLECTION_PACING, lowest)).toBe(0)
    expect(collectionDelayMs(2, DEFAULT_COLLECTION_PACING, lowest)).toBe(3_000)
    expect(collectionDelayMs(20, DEFAULT_COLLECTION_PACING, lowest)).toBe(33_000)
    expect(collectionDelayMs(100, DEFAULT_COLLECTION_PACING, lowest)).toBe(213_000)
    expect(collectionDelayMs(100, DEFAULT_COLLECTION_PACING, highest)).toBe(456_000)
  })

  it('draws from the ranges the operator set', () => {
    expect(collectionDelayMs(2, FORMER, lowest)).toBe(5_000)
    expect(collectionDelayMs(20, FORMER, lowest)).toBe(125_000)
    expect(collectionDelayMs(100, FORMER, lowest)).toBe(725_000)
  })

  it('keeps the page gap at or above the one-second floor and lets breaks go to zero', () => {
    const pacing = normalizeCollectionPacing({
      perPage: { minSeconds: 0, maxSeconds: 0 },
      everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
      everyHundredPages: { minSeconds: -5, maxSeconds: 99_999 },
    })
    expect(pacing.perPage).toEqual({ minSeconds: MIN_PAGE_DELAY_SECONDS, maxSeconds: MIN_PAGE_DELAY_SECONDS })
    expect(pacing.everyTwentyPages).toEqual({ minSeconds: 0, maxSeconds: 0 })
    expect(pacing.everyHundredPages).toEqual({ minSeconds: 0, maxSeconds: MAX_BREAK_SECONDS })
  })

  it('raises the maximum to a minimum set above it, leaving the minimum as typed', () => {
    const pacing = normalizeCollectionPacing({ perPage: { minSeconds: 8, maxSeconds: 4 } })
    expect(pacing.perPage).toEqual({ minSeconds: 8, maxSeconds: 8 })
  })

  it('fills what is missing or unreadable from the defaults', () => {
    const pacing = normalizeCollectionPacing({
      perPage: { minSeconds: Number.NaN, maxSeconds: '5' as unknown as number },
    })
    expect(pacing.perPage).toEqual(DEFAULT_COLLECTION_PACING.perPage)
    expect(pacing.everyTwentyPages).toEqual(DEFAULT_COLLECTION_PACING.everyTwentyPages)
    expect(pacing.everyHundredPages).toEqual(DEFAULT_COLLECTION_PACING.everyHundredPages)
  })

  it('budgets a work block from the middle of each range', () => {
    // At the former pacing a two-hour block held about 270 reads.
    const former = pagesPerWorkBlock(120, FORMER)
    expect(former).toBeGreaterThan(250)
    expect(former).toBeLessThan(300)
    // The faster defaults fit roughly two and a half times as many.
    const current = pagesPerWorkBlock(120, DEFAULT_COLLECTION_PACING)
    expect(current).toBeGreaterThan(former * 2)
  })

  it('scales the budget with the block length', () => {
    expect(pagesPerWorkBlock(30, DEFAULT_COLLECTION_PACING)).toBeLessThan(pagesPerWorkBlock(120, DEFAULT_COLLECTION_PACING))
  })

  it('stays bounded for a draft typed below the floor', () => {
    const draft = { ...DEFAULT_COLLECTION_PACING, perPage: { minSeconds: -20, maxSeconds: 6 } }
    expect(pagesPerWorkBlock(120, draft)).toBe(pagesPerWorkBlock(120, normalizeCollectionPacing(draft)))
  })

  it('stays bounded at the fastest allowed pacing', () => {
    const fastest = normalizeCollectionPacing({
      perPage: { minSeconds: 1, maxSeconds: 1 },
      everyTwentyPages: { minSeconds: 0, maxSeconds: 0 },
      everyHundredPages: { minSeconds: 0, maxSeconds: 0 },
    })
    expect(pagesPerWorkBlock(30, fastest)).toBe(30 * 60 + 1)
  })
})
