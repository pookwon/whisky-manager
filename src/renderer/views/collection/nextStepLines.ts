import { TEXT } from '../../../shared/text.js'
import { formatKstTime } from '../../format.js'
import type { NextStep } from './nextStep.js'

export function nextStepSentence(next: NextStep): string {
  switch (next.kind) {
    case 'running':
      return TEXT.collection.next.running[next.step]
    case 'resume': {
      const { stage } = next
      switch (stage.kind) {
        case 'list':
          return TEXT.collection.next.resume.list
        case 'search':
          return TEXT.collection.next.resume.search(stage.boardName ?? stage.boardId, stage.position, stage.count)
        case 'probe':
          return TEXT.collection.next.resume.probe
      }
    }
    case 'pickPeriod':
      return TEXT.collection.next.pickPeriod
    case 'allDone':
      return TEXT.collection.next.allDone
  }
}

/**
 * When the loop next takes a turn, under a resume sentence: the loop walks the
 * search and the probe too, so a newcomer can wait instead of pressing.
 */
export function nextStepScheduleLine(next: NextStep): string | null {
  if (next.kind !== 'resume') return null
  return next.nextRunAtMs === null ? TEXT.collection.nextRunNone : TEXT.collection.nextRunAt(formatKstTime(next.nextRunAtMs))
}
