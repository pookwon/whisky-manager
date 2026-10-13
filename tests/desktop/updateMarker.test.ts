import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUpdateMarker } from '../../src/desktop/updateMarker.js'

let directory: string
let path: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wm-marker-'))
  path = join(directory, 'nested', 'update-pending.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('the pending-update marker', () => {
  it('says nothing when no install was under way', () => {
    expect(createUpdateMarker(path).settle('1.9.17')).toBe('none')
  })

  it('reports an install that took, and removes the record', () => {
    const marker = createUpdateMarker(path)
    expect(marker.write({ from: '1.9.17', to: '1.9.18' })).toBe(true)

    expect(marker.settle('1.9.18')).toBe('installed')
    expect(existsSync(path)).toBe(false)
  })

  it('reports an install that did not take', () => {
    const marker = createUpdateMarker(path)
    marker.write({ from: '1.9.17', to: '1.9.18' })

    expect(marker.settle('1.9.17')).toBe('failed')
    expect(existsSync(path)).toBe(false)
  })

  it('ignores a record whose versions are neither this one nor its aim', () => {
    const marker = createUpdateMarker(path)
    marker.write({ from: '1.9.17', to: '1.9.18' })

    expect(marker.settle('1.9.20')).toBe('none')
    expect(existsSync(path)).toBe(false)
  })

  it('drops a record it cannot read instead of tripping on it forever', () => {
    const marker = createUpdateMarker(join(directory, 'broken.json'))
    writeFileSync(join(directory, 'broken.json'), '{not json')

    expect(marker.settle('1.9.17')).toBe('none')
    expect(existsSync(join(directory, 'broken.json'))).toBe(false)
  })

  it('answers false when the record cannot be written', () => {
    const blocker = join(directory, 'file')
    writeFileSync(blocker, 'x')

    expect(createUpdateMarker(join(blocker, 'update-pending.json')).write({ from: 'a', to: 'b' })).toBe(false)
  })
})
