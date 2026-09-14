import { describe, expect, it, vi } from 'vitest'
import { createDiagnosticsLog } from '../../src/desktop/diagnosticsLog.js'

function log(capacity = 3) {
  let now = 1_000
  const sink = { error: vi.fn(), warn: vi.fn() }
  const diagnostics = createDiagnosticsLog({ capacity, now: () => (now += 1), sink })
  return { diagnostics, sink }
}

describe('createDiagnosticsLog', () => {
  it('keeps what was reported, newest last, and still says it on the console', () => {
    const { diagnostics, sink } = log()
    diagnostics.error('collection', new Error('boom'))
    diagnostics.warn('warm', 'lapsed')

    expect(diagnostics.recent()).toEqual([
      { atMs: 1_001, level: 'error', tag: 'collection', text: 'Error: boom' },
      { atMs: 1_002, level: 'warn', tag: 'warm', text: 'lapsed' },
    ])
    expect(sink.error).toHaveBeenCalledWith('[collection]', expect.any(Error))
    expect(sink.warn).toHaveBeenCalledWith('[warm]', 'lapsed')
  })

  it('drops the oldest once the capacity is reached', () => {
    const { diagnostics } = log(2)
    diagnostics.warn('a', 'one')
    diagnostics.warn('b', 'two')
    diagnostics.warn('c', 'three')

    expect(diagnostics.recent().map((entry) => entry.text)).toEqual(['two', 'three'])
  })

  it('writes down an object as json and anything else by its string form', () => {
    const { diagnostics } = log()
    diagnostics.error('member', { name: 'TypeError', message: 'x' })
    diagnostics.warn('n', 42)

    expect(diagnostics.recent().map((entry) => entry.text)).toEqual(['{"name":"TypeError","message":"x"}', '42'])
  })

  it('hands out a copy, so a reader cannot change the record', () => {
    const { diagnostics } = log()
    diagnostics.warn('a', 'one')
    const first = diagnostics.recent()
    diagnostics.warn('b', 'two')

    expect(first).toHaveLength(1)
  })
})
