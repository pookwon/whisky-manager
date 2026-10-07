import { describe, expect, it } from 'vitest'
import { replaceLaterStepsLine } from '../../src/renderer/views/collection/replacePeriodLines.js'
import { TEXT } from '../../src/shared/text.js'

const PERIOD = { fromDay: '20240101', toDay: '20250102' }

describe('replace period lines', () => {
  it('says the later steps start over once the list is done and they are under way', () => {
    expect(replaceLaterStepsLine({ kind: 'search', period: PERIOD, boardId: '137', boardName: null, position: 1, count: 1, searchExtended: true })).toBe(TEXT.collection.replace.laterStepsCost)
    expect(replaceLaterStepsLine({ kind: 'probe', period: PERIOD })).toBe(TEXT.collection.replace.laterStepsCost)
  })

  it('says nothing more while the list itself is the work in hand', () => {
    expect(replaceLaterStepsLine({ kind: 'list', period: PERIOD })).toBeNull()
    expect(replaceLaterStepsLine({ kind: 'idle' })).toBeNull()
  })
})
