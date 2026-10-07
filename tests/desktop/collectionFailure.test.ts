import { describe, expect, it } from 'vitest'
import { describeFailure, stopReasonDetail } from '../../src/desktop/collectionFailure.js'

describe('describeFailure', () => {
  it('names the error and keeps its message on one line', () => {
    expect(describeFailure(new Error('request COLLECT_BOARD_PAGE timed out\n after 20000ms'))).toBe('Error: request COLLECT_BOARD_PAGE timed out after 20000ms')
  })

  it('bounds the length', () => {
    const long = describeFailure(new Error('x'.repeat(500)))
    expect(long.length).toBe(200)
    expect(long.endsWith('…')).toBe(true)
  })

  it('keeps any stop reason detail on one bounded line', () => {
    expect(stopReasonDetail('INVALID_PAGE_INFO:\n  result.pageInfo must be an object ')).toBe('INVALID_PAGE_INFO: result.pageInfo must be an object')
    expect(stopReasonDetail('y'.repeat(500))).toHaveLength(200)
  })

  it('stringifies a thrown non-error', () => {
    expect(describeFailure('socket hung up')).toBe('socket hung up')
  })
})
