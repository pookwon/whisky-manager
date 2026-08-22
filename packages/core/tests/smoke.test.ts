import { describe, expect, it } from 'vitest'
import { CORE_PACKAGE_NAME } from '../src/index.js'

describe('core package', () => {
  it('exposes its package name', () => {
    expect(CORE_PACKAGE_NAME).toBe('@ncafe/core')
  })
})
