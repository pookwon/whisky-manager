import { describe, expect, it } from 'vitest'
import { laterPostId } from '../../src/shared/postId.js'

describe('laterPostId', () => {
  it('takes the candidate when nothing is recorded yet', () => {
    expect(laterPostId(null, '1001')).toBe('1001')
  })

  it('compares numerically, not lexicographically', () => {
    // '9' > '10' as strings, which would stall the watermark forever.
    expect(laterPostId('9', '10')).toBe('10')
    expect(laterPostId('10', '9')).toBe('10')
  })

  it('keeps the current value when the candidate is older', () => {
    expect(laterPostId('1005', '1001')).toBe('1005')
  })

  it('handles ids beyond the safe integer range', () => {
    expect(laterPostId('9007199254740993', '9007199254740992')).toBe('9007199254740993')
  })

  it('falls back to lexicographic order for non-numeric ids', () => {
    expect(laterPostId('abc', 'abd')).toBe('abd')
  })
})
