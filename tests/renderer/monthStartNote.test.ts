import { describe, expect, it } from 'vitest'
import { TEXT } from '../../src/shared/text.js'
import { monthStartNote } from '../../src/renderer/views/dashboard/monthStartNote.js'
import type { MonthStartSeed } from '../../src/shared/monthStartSeed.js'

/** 2026-10-01 and 2026-11-01 at KST midnight. */
const OCT = { startMs: Date.UTC(2026, 8, 30, 15), endMs: Date.UTC(2026, 9, 31, 15) }
const SEP = { startMs: Date.UTC(2026, 7, 31, 15), endMs: Date.UTC(2026, 8, 30, 15) }
const seed = (replaced: MonthStartSeed['replaced']): MonthStartSeed => ({ period: OCT, replaced, madeAtMs: OCT.endMs + 3_600_000 })
const job = (period: { startMs: number; endMs: number }) => ({ targetStartMs: period.startMs, targetEndMs: period.endMs })

describe('month start note', () => {
  it('names the period made and the finished job it replaced, with the last day inclusive', () => {
    expect(monthStartNote(seed(SEP), job(OCT))).toEqual([
      TEXT.dashboard.monthStartMade('2026-10-01', '2026-10-31'),
      TEXT.dashboard.monthStartReplaced('2026-09-01', '2026-09-30'),
    ])
  })

  it('says only what was made when nothing was replaced', () => {
    expect(monthStartNote(seed(null), job(OCT))).toEqual([TEXT.dashboard.monthStartMade('2026-10-01', '2026-10-31')])
  })

  it('stays silent once the job on show is not the one the month start made', () => {
    expect(monthStartNote(seed(SEP), job(SEP))).toEqual([])
    expect(monthStartNote(seed(SEP), null)).toEqual([])
    expect(monthStartNote(null, job(OCT))).toEqual([])
  })
})
