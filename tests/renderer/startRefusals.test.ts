import { describe, expect, it } from 'vitest'
import { listStartRefusal } from '../../src/renderer/views/collection/startRefusals.js'
import { TEXT } from '../../src/shared/text.js'

describe('start refusals', () => {
  it('names a list refusal and a rejected period, and nothing for a start', () => {
    expect(listStartRefusal({ kind: 'refused', reason: 'BRIDGE_OFFLINE' })).toBe(TEXT.collection.refused.BRIDGE_OFFLINE)
    expect(listStartRefusal({ kind: 'rejected', problem: 'TOO_LONG' })).toBe(TEXT.collection.rejected.TOO_LONG)
    expect(listStartRefusal({ kind: 'started' })).toBeNull()
  })
})
