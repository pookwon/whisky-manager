import { describe, expect, it } from 'vitest'
import { updateNotice } from '../../src/renderer/updateNotice.js'
import { TEXT } from '../../src/shared/text.js'
import { KST_OFFSET_MS } from '../../src/shared/kst.js'

describe('what the operator is told about an update', () => {
  it('says nothing while there is nothing to say', () => {
    expect(updateNotice({ kind: 'idle' }, null)).toBeNull()
    expect(updateNotice({ kind: 'checking' }, null)).toBeNull()
  })

  it('offers the press once the update is ready', () => {
    expect(updateNotice({ kind: 'ready', version: '1.9.18' }, null)).toEqual({
      text: TEXT.update.ready('1.9.18'),
      action: { label: TEXT.update.apply, kind: 'apply' },
      tone: 'info',
    })
  })

  it('names the next session in KST while it waits, and offers to withdraw', () => {
    const at = Date.UTC(2026, 9, 14, 17, 16) // 02:16 KST the next day
    const notice = updateNotice({ kind: 'waitingIdle', version: '1.9.18' }, at)

    expect(notice?.text).toBe(TEXT.update.waitingUntil('1.9.18', '02:16'))
    expect(notice?.action).toEqual({ label: TEXT.update.cancelWaiting, kind: 'cancel' })
    expect(KST_OFFSET_MS).toBe(9 * 60 * 60 * 1000)
  })

  it('waits without a time when no session is scheduled', () => {
    expect(updateNotice({ kind: 'waitingIdle', version: '1.9.18' }, null)?.text).toBe(TEXT.update.waiting('1.9.18'))
  })

  it('gives each failure its own line, as a warning', () => {
    expect(updateNotice({ kind: 'failed', reason: 'DIGEST_MISMATCH' }, null)).toEqual({
      text: TEXT.update.failed.DIGEST_MISMATCH,
      action: null,
      tone: 'warn',
    })
  })
})
