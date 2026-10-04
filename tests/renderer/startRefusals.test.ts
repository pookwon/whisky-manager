import { describe, expect, it } from 'vitest'
import { listStartRefusal, probeStartRefusal, searchStartRefusal } from '../../src/renderer/views/collection/startRefusals.js'
import { TEXT } from '../../src/shared/text.js'

describe('start refusals', () => {
  it('names a list refusal and a rejected period, and nothing for a start', () => {
    expect(listStartRefusal({ kind: 'refused', reason: 'BRIDGE_OFFLINE' })).toBe(TEXT.collection.refused.BRIDGE_OFFLINE)
    expect(listStartRefusal({ kind: 'rejected', problem: 'TOO_LONG' })).toBe(TEXT.collection.rejected.TOO_LONG)
    expect(listStartRefusal({ kind: 'started' })).toBeNull()
  })

  it('names a missing job in the search and probe walks\' own words', () => {
    expect(searchStartRefusal({ kind: 'refused', reason: 'NO_JOB' })).toBe(TEXT.boardSearch.startRefused.NO_JOB)
    expect(probeStartRefusal({ kind: 'refused', reason: 'NO_JOB' })).toBe(TEXT.articleProbe.startRefused.NO_JOB)
    expect(searchStartRefusal({ kind: 'started' })).toBeNull()
    expect(probeStartRefusal({ kind: 'started' })).toBeNull()
  })
})
