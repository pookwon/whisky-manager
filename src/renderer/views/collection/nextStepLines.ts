import { TEXT } from '../../../shared/text.js'
import { formatKstTime } from '../../format.js'
import type { NextStep } from './nextStep.js'

export function nextStepSentence(next: NextStep): string {
  switch (next.kind) {
    case 'running':
      return TEXT.collection.next.running[next.step]
    case 'listWaiting':
      return next.nextRunAtMs === null
        ? TEXT.collection.next.listWaitingManual
        : TEXT.collection.next.listWaitingAt(formatKstTime(next.nextRunAtMs))
    case 'searchResume':
      return TEXT.collection.next.searchResume
    case 'probeResume':
      return TEXT.collection.next.probeResume
    case 'searchNeeded':
      return TEXT.collection.next.searchNeeded(next.boardName)
    case 'probeCreate':
      return TEXT.collection.next.probeCreate
    case 'probeSpent':
      return TEXT.collection.next.probeSpent
    case 'pickPeriod':
      return TEXT.collection.next.pickPeriod
    case 'allDone':
      return TEXT.collection.next.allDone
  }
}

/**
 * When the loop next takes a turn, under a resume sentence: the loop walks the
 * search and the probe too, so a newcomer can wait instead of pressing. The
 * list's own sentence already carries its time.
 */
export function nextStepScheduleLine(next: NextStep): string | null {
  if (next.kind !== 'searchResume' && next.kind !== 'probeResume') return null
  return next.nextRunAtMs === null ? TEXT.collection.nextRunNone : TEXT.collection.nextRunAt(formatKstTime(next.nextRunAtMs))
}
