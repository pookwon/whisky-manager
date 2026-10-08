import { describe, expect, it } from 'vitest'
import {
  BOARD_SEARCH_GIVE_UP_STREAK,
  belowProbeYieldStreak,
  endsBelowProbeYield,
  isSearchGivenUp,
  recordRequestYield,
  shouldStopBelowProbeYield,
} from '../../src/desktop/boardSearchYield.js'

const ended = (belowProbeYield: boolean, complete = true) => ({ complete, belowProbeYield })

describe('boardSearchYield', () => {
  it('keeps only the latest requests of the window', () => {
    let recent: readonly number[] = []
    for (const inserted of [9, 0, 1, 3]) recent = recordRequestYield(recent, inserted)
    expect(recent).toEqual([1, 3])
  })

  it('stops a query once a full window brings in fewer posts than requests', () => {
    expect(shouldStopBelowProbeYield([0])).toBe(false)
    expect(shouldStopBelowProbeYield([0, 1])).toBe(true)
    expect(shouldStopBelowProbeYield([1, 1])).toBe(false)
    expect(shouldStopBelowProbeYield([0, 2])).toBe(false)
  })

  it('reads a query that reached its end as below the probe when it never brought one post a request', () => {
    expect(endsBelowProbeYield({ insertedBefore: 0, inserted: 0, requests: 1 })).toBe(true)
    expect(endsBelowProbeYield({ insertedBefore: 0, inserted: 1, requests: 2 })).toBe(true)
    expect(endsBelowProbeYield({ insertedBefore: 0, inserted: 2, requests: 2 })).toBe(false)
  })

  it('counts what a resumed query brought in before towards its last run', () => {
    expect(endsBelowProbeYield({ insertedBefore: 120, inserted: 0, requests: 1 })).toBe(false)
  })

  it('counts the finished queries at the end of the queue that fell below the probe', () => {
    expect(belowProbeYieldStreak([ended(true), ended(false), ended(true), ended(true)])).toBe(2)
    expect(belowProbeYieldStreak([ended(true), ended(false)])).toBe(0)
  })

  it('passes over unfinished queries when counting the streak', () => {
    expect(belowProbeYieldStreak([ended(true), ended(false, false), ended(true)])).toBe(2)
  })

  it('gives the board up once the streak reaches its length', () => {
    const below = Array.from({ length: BOARD_SEARCH_GIVE_UP_STREAK }, () => ended(true))
    expect(isSearchGivenUp(below)).toBe(true)
    expect(isSearchGivenUp(below.slice(1))).toBe(false)
  })
})
