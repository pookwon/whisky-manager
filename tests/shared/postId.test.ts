import { describe, expect, it } from 'vitest'
import { comparePostId } from '../../src/shared/postId.js'

describe('comparePostId', () => {
  it('returns 0 when ids are identical', () => {
    expect(comparePostId('1001', '1001')).toBe(0)
  })

  it('compares numerically, not lexicographically', () => {
    // '9' > '10' as strings, which would be wrong numerically.
    expect(comparePostId('9', '10')).toBe(-1)
    expect(comparePostId('10', '9')).toBe(1)
  })

  it('returns -1 when the left is smaller', () => {
    expect(comparePostId('1001', '1005')).toBe(-1)
  })

  it('returns 1 when the left is larger', () => {
    expect(comparePostId('1005', '1001')).toBe(1)
  })

  it('handles ids beyond the safe integer range', () => {
    expect(comparePostId('9007199254740992', '9007199254740993')).toBe(-1)
    expect(comparePostId('9007199254740993', '9007199254740992')).toBe(1)
  })

  it('falls back to lexicographic order for non-numeric ids', () => {
    expect(comparePostId('abc', 'abd')).toBe(-1)
    expect(comparePostId('abd', 'abc')).toBe(1)
    expect(comparePostId('abc', 'abc')).toBe(0)
  })
})
