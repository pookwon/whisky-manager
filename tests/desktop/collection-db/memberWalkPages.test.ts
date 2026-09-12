import { describe, expect, it } from 'vitest'
import { walkPagesStored } from '../../../src/desktop/collection-db/memberStatusQuery.js'

describe('walkPagesStored', () => {
  it('reads the cursor during a restarted walk instead of an earlier walk’s furthest page', () => {
    // An earlier walk reached page 1745; the cursor was cleared and a new backfill is on page 20.
    expect(walkPagesStored({ complete: false, referencePage: 20, maxCommittedWalkPage: 1745 })).toBe(20)
  })

  it('reads zero before the first page of a walk is committed', () => {
    expect(walkPagesStored({ complete: false, referencePage: null, maxCommittedWalkPage: 1745 })).toBe(0)
  })

  it('keeps the walk’s furthest page once complete, where daily top-ups reset the cursor to page 1', () => {
    expect(walkPagesStored({ complete: true, referencePage: 1, maxCommittedWalkPage: 2094 })).toBe(2094)
  })
})
