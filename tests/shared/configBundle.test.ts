import { describe, expect, it } from 'vitest'
import {
  CONFIG_BUNDLE_VERSION,
  parseConfigBundle,
  serializeConfigBundle,
  type ConfigBundle,
} from '../../src/shared/configBundle.js'

const VALID: ConfigBundle = {
  version: CONFIG_BUNDLE_VERSION,
  exportedAt: 1_756_252_800_000,
  common: {
    cafeId: '31068798',
    cafeUrlName: 'whiskyclub',
    operatorAccounts: ['staff1'],
  },
  automations: [
    {
      id: 'welcome-comment',
      policy: 'SEMI',
      boardId: '42',
      enabled: true,
      templates: [{ body: '{닉네임}님 환영합니다', enabled: true }],
    },
  ],
}

function parse(value: unknown) {
  return parseConfigBundle(JSON.stringify(value))
}

describe('parseConfigBundle', () => {
  it('accepts a file this build wrote', () => {
    const result = parseConfigBundle(serializeConfigBundle(VALID))
    expect(result).toEqual({ ok: true, bundle: VALID })
  })

  it('refuses something that is not JSON at all', () => {
    expect(parseConfigBundle('not json {')).toEqual({ ok: false, problem: 'NOT_JSON' })
  })

  it('refuses a top level that is not an object', () => {
    expect(parse([VALID])).toEqual({ ok: false, problem: 'NOT_A_BUNDLE' })
    expect(parse(null)).toEqual({ ok: false, problem: 'NOT_A_BUNDLE' })
    expect(parseConfigBundle('"a string"')).toEqual({ ok: false, problem: 'NOT_A_BUNDLE' })
  })

  it('refuses an object with no version, which is any other JSON file', () => {
    expect(parse({ common: VALID.common, automations: [] })).toEqual({
      ok: false,
      problem: 'NOT_A_BUNDLE',
    })
  })

  it('names an unreadable version rather than blaming the shape', () => {
    // A newer export will have fields this build does not know. Saying "not our
    // file" would send the operator looking for a file they already have.
    expect(parse({ ...VALID, version: CONFIG_BUNDLE_VERSION + 1, common: 'whatever' })).toEqual({
      ok: false,
      problem: 'UNSUPPORTED_VERSION',
    })
  })

  it('refuses a bundle whose common block is missing', () => {
    expect(parse({ version: CONFIG_BUNDLE_VERSION, automations: [] })).toEqual({
      ok: false,
      problem: 'NOT_A_BUNDLE',
    })
  })

  it('refuses an automation with no id or an unknown policy', () => {
    expect(parse({ ...VALID, automations: [{ policy: 'AUTO', boardId: '1' }] })).toEqual({
      ok: false,
      problem: 'NOT_A_BUNDLE',
    })
    expect(parse({ ...VALID, automations: [{ id: 'x', policy: 'WHENEVER' }] })).toEqual({
      ok: false,
      problem: 'NOT_A_BUNDLE',
    })
  })

  it('refuses a file with no cafe, which could never open a session', () => {
    expect(parse({ ...VALID, common: { ...VALID.common, cafeId: '   ' } })).toEqual({
      ok: false,
      problem: 'NO_CAFE',
    })
  })

  it('drops blank and duplicate operator accounts', () => {
    const result = parse({
      ...VALID,
      common: { ...VALID.common, operatorAccounts: ['staff1', '  ', 'staff1', 42, ' staff2 '] },
    })
    expect(result.ok && result.bundle.common.operatorAccounts).toEqual(['staff1', 'staff2'])
  })

  it('drops a blank template body, which would post an empty comment', () => {
    const result = parse({
      ...VALID,
      automations: [{ ...VALID.automations[0], templates: [{ body: '   ' }, { body: '환영합니다' }] }],
    })
    expect(result.ok && result.bundle.automations[0]?.templates).toEqual([
      { body: '환영합니다', enabled: true },
    ])
  })

  it('treats a template with no enabled field as enabled', () => {
    const result = parse({
      ...VALID,
      automations: [{ ...VALID.automations[0], templates: [{ body: '환영합니다' }] }],
    })
    expect(result.ok && result.bundle.automations[0]?.templates[0]?.enabled).toBe(true)
  })

  it('keeps a template that was switched off', () => {
    const result = parse({
      ...VALID,
      automations: [
        { ...VALID.automations[0], templates: [{ body: '환영합니다', enabled: false }] },
      ],
    })
    expect(result.ok && result.bundle.automations[0]?.templates[0]?.enabled).toBe(false)
  })

  it('trims the cafe and board rather than storing padded ids', () => {
    const result = parse({
      ...VALID,
      common: { ...VALID.common, cafeId: ' 31068798 ', cafeUrlName: ' whiskyclub ' },
      automations: [{ ...VALID.automations[0], boardId: ' 42 ' }],
    })
    expect(result.ok && result.bundle.common.cafeId).toBe('31068798')
    expect(result.ok && result.bundle.common.cafeUrlName).toBe('whiskyclub')
    expect(result.ok && result.bundle.automations[0]?.boardId).toBe('42')
  })
})
