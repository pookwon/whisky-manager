import { describe, expect, it, vi } from 'vitest'
import { createFingerprintedRead } from '../../../src/desktop/collection-db/fingerprintedRead.js'

describe('createFingerprintedRead', () => {
  it('reads again only when the fingerprint changes', async () => {
    const compute = vi.fn(() => Promise.resolve(42))
    const read = createFingerprintedRead(compute)

    expect(await read('266605:211294')).toBe(42)
    expect(await read('266605:211294')).toBe(42)
    expect(compute).toHaveBeenCalledTimes(1)

    await read('266606:211294')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('shares one read between callers that ask at the same time', async () => {
    const compute = vi.fn(() => Promise.resolve('matched'))
    const read = createFingerprintedRead(compute)

    const answers = await Promise.all([read('a'), read('a'), read('a')])

    expect(answers).toEqual(['matched', 'matched', 'matched'])
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not keep a failed read', async () => {
    const compute = vi.fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(7)
    const read = createFingerprintedRead(compute)

    await expect(read('a')).rejects.toThrow('connection lost')
    expect(await read('a')).toBe(7)
    expect(compute).toHaveBeenCalledTimes(2)
  })
})
