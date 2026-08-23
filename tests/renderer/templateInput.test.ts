import { describe, expect, it } from 'vitest'
import { isSubmitKey } from '../../src/renderer/views/templateInput.js'

const key = (over: Partial<Parameters<typeof isSubmitKey>[0]> = {}) => ({
  key: 'Enter',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
})

describe('isSubmitKey', () => {
  it('submits on Cmd+Enter and Ctrl+Enter', () => {
    expect(isSubmitKey(key({ metaKey: true }))).toBe(true)
    expect(isSubmitKey(key({ ctrlKey: true }))).toBe(true)
  })

  // Plain Enter has to reach the textarea, or a multi-line greeting cannot be
  // typed at all.
  it('leaves a plain Enter to the textarea', () => {
    expect(isSubmitKey(key())).toBe(false)
    expect(isSubmitKey(key({ shiftKey: true }))).toBe(false)
  })

  it('ignores other keys even with a modifier', () => {
    expect(isSubmitKey(key({ key: 'a', metaKey: true }))).toBe(false)
    expect(isSubmitKey(key({ key: 'Escape', ctrlKey: true }))).toBe(false)
  })
})
