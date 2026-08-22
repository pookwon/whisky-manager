import { describe, expect, it } from 'vitest'
import { PROJECT_NAME } from '../../src/shared/index.js'

describe('shared module', () => {
  it('exposes its package name', () => {
    expect(PROJECT_NAME).toBe('whisky-manager')
  })
})
