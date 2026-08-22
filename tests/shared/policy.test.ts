import { describe, expect, it } from 'vitest'
import { decide } from '../../src/shared/policy.js'

const clean = { skip: null, flags: [] } as const
const flagged = { skip: null, flags: ['STRUCTURE_CHANGED'] } as const
const skipped = { skip: 'ALREADY_COMMENTED', flags: [] } as const

describe('decide', () => {
  it('executes a clean candidate under AUTO', () => {
    expect(decide('AUTO', clean)).toEqual({ kind: 'EXECUTE' })
  })

  it('skips a flagged candidate under AUTO instead of calling a human', () => {
    expect(decide('AUTO', flagged)).toEqual({ kind: 'SKIP', reason: 'RISK_FLAGGED' })
  })

  it('executes a clean candidate under SEMI', () => {
    expect(decide('SEMI', clean)).toEqual({ kind: 'EXECUTE' })
  })

  it('routes a flagged candidate to approval under SEMI', () => {
    expect(decide('SEMI', flagged)).toEqual({ kind: 'APPROVE_FIRST' })
  })

  it('routes every candidate to approval under MANUAL', () => {
    expect(decide('MANUAL', clean)).toEqual({ kind: 'APPROVE_FIRST' })
    expect(decide('MANUAL', flagged)).toEqual({ kind: 'APPROVE_FIRST' })
  })

  it('honours a guard skip regardless of policy', () => {
    for (const policy of ['AUTO', 'SEMI', 'MANUAL'] as const) {
      expect(decide(policy, skipped)).toEqual({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })
    }
  })
})
