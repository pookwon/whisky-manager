import { describe, expect, it } from 'vitest'
import { InvalidTransitionError, initialStatus, transition } from '../../src/shared/statusMachine.js'

const limits = { maxAttempts: 3 }

describe('initialStatus', () => {
  it('queues an executable candidate', () => {
    expect(initialStatus({ kind: 'EXECUTE' })).toBe('QUEUED')
  })

  it('parks a candidate that needs approval', () => {
    expect(initialStatus({ kind: 'APPROVE_FIRST' })).toBe('AWAITING_APPROVAL')
  })

  it('terminates a skipped candidate immediately', () => {
    expect(initialStatus({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })).toBe('SKIPPED')
  })
})

describe('transition from AWAITING_APPROVAL', () => {
  it('queues on approval', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'APPROVED' }, limits)).toBe('QUEUED')
  })

  it('skips on rejection', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'REJECTED' }, limits)).toBe('SKIPPED')
  })

  it('expires after the approval ttl', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'APPROVAL_EXPIRED' }, limits)).toBe('EXPIRED')
  })

  it('cancels on kill switch', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'KILLED' }, limits)).toBe('CANCELLED')
  })
})

describe('transition from QUEUED', () => {
  it('succeeds', () => {
    expect(transition('QUEUED', { type: 'EXECUTION_SUCCEEDED' }, limits)).toBe('SUCCESS')
  })

  it('waits for retry while attempts remain', () => {
    expect(transition('QUEUED', { type: 'EXECUTION_FAILED', attempts: 1 }, limits)).toBe('RETRY_WAIT')
    expect(transition('QUEUED', { type: 'EXECUTION_FAILED', attempts: 2 }, limits)).toBe('RETRY_WAIT')
  })

  it('fails permanently once attempts are exhausted', () => {
    expect(transition('QUEUED', { type: 'EXECUTION_FAILED', attempts: 3 }, limits)).toBe('FAILED')
  })

  it('expires when the daily cap blocks it', () => {
  })
})

describe('transition from RETRY_WAIT', () => {
  it('re-queues on the next session without re-claiming', () => {
    expect(transition('RETRY_WAIT', { type: 'RETRY_DUE' }, limits)).toBe('QUEUED')
  })

  it('expires when it grows stale', () => {
    expect(transition('RETRY_WAIT', { type: 'APPROVAL_EXPIRED' }, limits)).toBe('EXPIRED')
  })
})

describe('terminal statuses', () => {
  it('rejects any transition out of a terminal status', () => {
    for (const terminal of ['SUCCESS', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(() => transition(terminal, { type: 'APPROVED' }, limits)).toThrow(InvalidTransitionError)
    }
  })
})

describe('invalid transitions', () => {
  it('rejects approving something already queued', () => {
    expect(() => transition('QUEUED', { type: 'APPROVED' }, limits)).toThrow(InvalidTransitionError)
  })

  it('rejects executing something awaiting approval', () => {
    expect(() => transition('AWAITING_APPROVAL', { type: 'EXECUTION_SUCCEEDED' }, limits)).toThrow(
      InvalidTransitionError,
    )
  })
})
