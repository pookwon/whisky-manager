import { TEXT } from '../shared/text.js'
import type { UpdateState } from '../shared/updateStatus.js'
import { formatKstTime } from './format.js'

export interface UpdateNotice {
  readonly text: string
  /** The one press this notice offers, if any. */
  readonly action: { readonly label: string; readonly kind: 'apply' | 'cancel' } | null
  readonly tone: 'info' | 'warn'
}

/**
 * What the operator is told about the app's own update, or null when there is
 * nothing to say. `nextSessionAt` is when the next greeting session is due, so
 * that waiting for work to end comes with a time.
 */
export function updateNotice(state: UpdateState, nextSessionAt: number | null): UpdateNotice | null {
  switch (state.kind) {
    case 'idle':
    case 'checking':
      return null
    case 'downloading':
      return { text: TEXT.update.downloading(state.version), action: null, tone: 'info' }
    case 'ready':
      return { text: TEXT.update.ready(state.version), action: { label: TEXT.update.apply, kind: 'apply' }, tone: 'info' }
    case 'waitingIdle':
      return {
        text:
          nextSessionAt === null
            ? TEXT.update.waiting(state.version)
            : TEXT.update.waitingUntil(state.version, formatKstTime(nextSessionAt)),
        action: { label: TEXT.update.cancelWaiting, kind: 'cancel' },
        tone: 'info',
      }
    case 'applying':
      return { text: TEXT.update.applying, action: null, tone: 'info' }
    case 'handedOver':
      return { text: TEXT.update.handedOver(state.version), action: null, tone: 'info' }
    case 'failed':
      return { text: TEXT.update.failed[state.reason], action: null, tone: 'warn' }
  }
}
