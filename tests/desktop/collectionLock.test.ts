import { describe, expect, it } from 'vitest'
import { createCollectionLock } from '../../src/desktop/collectionLock.js'

describe('collectionLock', () => {
  it('grants to one holder at a time', () => {
    const lock = createCollectionLock()
    expect(lock.tryAcquire()).toBe(true)
    expect(lock.isHeld()).toBe(true)
    expect(lock.tryAcquire()).toBe(false)
    lock.release()
    expect(lock.isHeld()).toBe(false)
    expect(lock.tryAcquire()).toBe(true)
  })
})
