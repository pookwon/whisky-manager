import { describe, expect, it } from 'vitest'
import { openOptionalCollectionContext } from '../../src/desktop/collectionContext.js'

describe('optional collection context', () => {
  it('leaves the existing application path enabled without DATABASE_URL', async () => {
    const context = await openOptionalCollectionContext({})
    expect(context.kind).toBe('disabled')
    await expect(context.close()).resolves.toBeUndefined()
  })
})
