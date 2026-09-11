import { describe, expect, it, vi } from 'vitest'
import { AUTOMATIONS } from '../../src/shared/automations/catalog.js'
import { parseExcludedBoardLines } from '../../src/renderer/views/settings/excludedBoards.js'

// The sections save through the renderer api, which reads window.wm at module
// load, so the stub must exist before they are imported.
vi.stubGlobal('window', { wm: {} })
const { SETTINGS_SECTIONS } = await import('../../src/renderer/views/settings/sections.js')

describe('settings sections', () => {
  it('every catalogued automation names a settings section that exists', () => {
    for (const automation of AUTOMATIONS) expect(SETTINGS_SECTIONS[automation.settingsSection]).toBeTypeOf('function')
  })
})

describe('parseExcludedBoardLines', () => {
  it('parses an excluded-board textarea into ids and names the first bad line', () => {
    expect(parseExcludedBoardLines('147\n 1 \n\n165')).toEqual({ ok: true, ids: ['147', '1', '165'] })
    expect(parseExcludedBoardLines('147\nabc')).toEqual({ ok: false, invalid: 'abc' })
  })

  it('reads an empty textarea as excluding nothing', () => {
    expect(parseExcludedBoardLines('')).toEqual({ ok: true, ids: [] })
    expect(parseExcludedBoardLines('\n  \n')).toEqual({ ok: true, ids: [] })
  })

  it('names the bad line as the operator would find it, without the stray spaces', () => {
    // A digit with a letter stuck to it is the likeliest typo, and the one a
    // looser check would let through as a board that never matches.
    expect(parseExcludedBoardLines('147\n 12a \n165')).toEqual({ ok: false, invalid: '12a' })
  })
})
