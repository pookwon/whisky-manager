import { describe, expect, it } from 'vitest'
import { renderPrefixReminder } from '../../../../src/shared/automations/prefix-reminder/render.js'

describe('renderPrefixReminder', () => {
  it('refuses when no comment text is configured', () => {
    expect(renderPrefixReminder('')).toEqual({ ok: false, missing: ['comment'] })
    expect(renderPrefixReminder('   ')).toEqual({ ok: false, missing: ['comment'] })
  })
  it('posts the configured text with no template behind it', () => {
    expect(renderPrefixReminder('  말머리를 골라 주세요  ')).toEqual({
      ok: true,
      templateId: null,
      body: '말머리를 골라 주세요',
    })
  })
})
