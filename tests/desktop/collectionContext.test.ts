import { describe, expect, it } from 'vitest'
import {
  classifyCollectionContextError,
  openOptionalCollectionContext,
} from '../../src/desktop/collectionContext.js'

describe('optional collection context', () => {
  it('leaves the existing application path enabled when no URL was configured', async () => {
    const context = await openOptionalCollectionContext(() => null)
    expect(context.kind).toBe('disabled')
    await expect(context.close()).resolves.toBeUndefined()
  })

  it('reports missing packaged migrations before attempting a connection', async () => {
    const context = await openOptionalCollectionContext(
      () => 'postgresql://127.0.0.1/not-contacted',
      '/definitely/missing/drizzle-collection',
    )
    expect(context).toMatchObject({ kind: 'unavailable', code: 'COLLECTION_MIGRATION_FILES_MISSING' })
  })

  it('classifies authentication separately without exposing a driver message', () => {
    expect(classifyCollectionContextError({ code: '28P01', message: 'contains user and host' })).toBe(
      'COLLECTION_AUTHENTICATION_FAILED',
    )
    expect(classifyCollectionContextError({ code: 'ECONNREFUSED' })).toBe('COLLECTION_CONNECTION_FAILED')
  })
})
