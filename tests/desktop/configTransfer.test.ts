import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationSettingsRepo } from '../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSettingsRepo } from '../../src/desktop/db/settingsRepo.js'
import { createTemplatesRepo } from '../../src/desktop/db/templatesRepo.js'
import { applyBundle, buildBundle, type ConfigTransferDeps } from '../../src/desktop/configTransfer.js'
import { WELCOME_AUTOMATION_ID } from '../../src/shared/automations/catalog.js'
import { CONFIG_BUNDLE_VERSION, type ConfigBundle } from '../../src/shared/configBundle.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const NOW = Date.UTC(2026, 7, 27, 1, 0, 0)

let dir: string
let db: AppDatabase
let counter: number

function build(nowMs = NOW): ConfigTransferDeps {
  return {
    settings: createSettingsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings: createAutomationSettingsRepo(db),
    transaction: (run) => {
      db.transaction(() => {
        run()
      })
    },
    now: () => nowMs,
    newId: () => `t-${++counter}`,
  }
}

function bundle(overrides: Partial<ConfigBundle> = {}): ConfigBundle {
  return {
    version: CONFIG_BUNDLE_VERSION,
    exportedAt: NOW,
    common: { cafeId: '31068798', cafeUrlName: 'whiskyclub', operatorAccounts: ['staff1'] },
    automations: [
      {
        id: WELCOME_AUTOMATION_ID,
        policy: 'SEMI',
        boardId: '42',
        enabled: true,
        templates: [
          { body: '첫 번째', enabled: true },
          { body: '두 번째', enabled: false },
        ],
      },
    ],
    ...overrides,
  }
}

/** A configuration as a developer would have left one behind. */
function seedConfigured(deps: ConfigTransferDeps): void {
  deps.settings.set('cafeId', '10000000')
  deps.settings.set('cafeUrlName', 'devcafe')
  deps.settings.set('operatorAccounts', JSON.stringify(['devstaff']))
  deps.settings.set('pairingToken', 'this-machines-secret')
  deps.settings.set('boundExtensionId', 'abcdefghijklmnop')
  deps.automationSettings.upsert({
    automationId: WELCOME_AUTOMATION_ID,
    policy: 'MANUAL',
    limits: {},
    enabled: true,
    boardId: '5',
  })
  deps.templates.add({ id: 'old-1', automationId: WELCOME_AUTOMATION_ID, body: '개발 문구', createdAt: 1 })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-transfer-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('buildBundle', () => {
  it('carries the cafe, the accounts, the policy and the board', () => {
    const deps = build()
    seedConfigured(deps)

    expect(buildBundle(deps)).toEqual({
      version: CONFIG_BUNDLE_VERSION,
      exportedAt: NOW,
      common: { cafeId: '10000000', cafeUrlName: 'devcafe', operatorAccounts: ['devstaff'] },
      automations: [
        {
          id: WELCOME_AUTOMATION_ID,
          policy: 'MANUAL',
          boardId: '5',
          enabled: true,
          templates: [{ body: '개발 문구', enabled: true }],
        },
      ],
    })
  })

  it('never carries the pairing token or the bound extension', () => {
    // The round trip below only compares what was included, so it cannot catch
    // a secret riding along. This is the assertion that can.
    const deps = build()
    seedConfigured(deps)

    const serialized = JSON.stringify(buildBundle(deps))
    expect(serialized).not.toContain('this-machines-secret')
    expect(serialized).not.toContain('abcdefghijklmnop')
    expect(serialized).not.toContain('pairingToken')
    expect(serialized).not.toContain('boundExtensionId')
  })

  it('never carries the pacing limits', () => {
    // A debug profile's intervals loose on an operator's install would knock on
    // the cafe every few minutes. The file has no place to put them.
    const deps = build()
    deps.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: { actionIntervalMinMs: 3_000, perSessionCap: 5 },
      enabled: false,
      boardId: '5',
    })

    expect(JSON.stringify(buildBundle(deps))).not.toContain('actionIntervalMinMs')
  })

  it('carries a template the operator switched off', () => {
    const deps = build()
    deps.templates.add({ id: 'a', automationId: WELCOME_AUTOMATION_ID, body: '켜짐', createdAt: 1 })
    deps.templates.add({ id: 'b', automationId: WELCOME_AUTOMATION_ID, body: '꺼짐', createdAt: 2 })
    deps.templates.setEnabled('b', false)

    expect(buildBundle(deps).automations[0]?.templates).toEqual([
      { body: '켜짐', enabled: true },
      { body: '꺼짐', enabled: false },
    ])
  })

  it('describes an untouched install rather than failing on it', () => {
    const built = buildBundle(build())
    expect(built.common).toEqual({ cafeId: '', cafeUrlName: '', operatorAccounts: [] })
    expect(built.automations[0]).toEqual({
      id: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      boardId: '',
      enabled: false,
      templates: [],
    })
  })
})

describe('applyBundle', () => {
  it('replaces the cafe and the accounts', () => {
    const deps = build()
    seedConfigured(deps)

    applyBundle(deps, bundle())

    expect(deps.settings.get('cafeId')).toBe('31068798')
    expect(deps.settings.get('cafeUrlName')).toBe('whiskyclub')
    expect(deps.settings.get('operatorAccounts')).toBe(JSON.stringify(['staff1']))
  })

  it('leaves the pairing token and the bound extension alone', () => {
    // They belong to this machine's extension. An import that cleared them
    // would unpair a browser the operator had already connected.
    const deps = build()
    seedConfigured(deps)

    applyBundle(deps, bundle())

    expect(deps.settings.get('pairingToken')).toBe('this-machines-secret')
    expect(deps.settings.get('boundExtensionId')).toBe('abcdefghijklmnop')
  })

  it('lands switched on when the file says so', () => {
    const deps = build()
    seedConfigured(deps)

    applyBundle(deps, bundle())

    const setting = deps.automationSettings.get(WELCOME_AUTOMATION_ID)
    expect(setting?.enabled).toBe(true)
    expect(setting?.policy).toBe('SEMI')
    expect(setting?.boardId).toBe('42')
  })

  it('lands switched off when the file says so', () => {
    // The install being written over has it on, so obeying the file here means
    // turning something off rather than leaving it alone.
    const deps = build()
    seedConfigured(deps)
    const file = bundle()

    applyBundle(deps, { ...file, automations: [{ ...file.automations[0]!, enabled: false }] })

    expect(deps.automationSettings.get(WELCOME_AUTOMATION_ID)?.enabled).toBe(false)
  })

  it('does not reach the pacing limits already on this install', () => {
    const deps = build()
    deps.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: { perSessionCap: 9 },
      enabled: false,
      boardId: '5',
    })

    applyBundle(deps, bundle())

    expect(deps.automationSettings.get(WELCOME_AUTOMATION_ID)?.limits).toEqual({ perSessionCap: 9 })
  })

  it('swaps the templates wholesale, keeping the file order', () => {
    const deps = build()
    seedConfigured(deps)

    const summary = applyBundle(deps, bundle())

    expect(deps.templates.listAll(WELCOME_AUTOMATION_ID).map((t) => t.body)).toEqual([
      '첫 번째',
      '두 번째',
    ])
    expect(summary).toEqual({ automationCount: 1, templateCount: 2, enabledCount: 1 })
  })

  it('preserves whether each imported template is switched on', () => {
    const deps = build()

    applyBundle(deps, bundle())

    expect(deps.templates.listEnabled(WELCOME_AUTOMATION_ID).map((t) => t.body)).toEqual(['첫 번째'])
  })

  it('gives imported templates identities of this database', () => {
    const deps = build()
    seedConfigured(deps)

    applyBundle(deps, bundle())

    expect(deps.templates.listAll(WELCOME_AUTOMATION_ID).map((t) => t.id)).toEqual(['t-1', 't-2'])
  })

  it('stores a blank board as unconfigured rather than as an empty id', () => {
    // The session asks `isConfigured`, which an empty string fails anyway — but
    // null is what "never named" means everywhere else in this table.
    const deps = build()
    const file = bundle()
    applyBundle(deps, {
      ...file,
      automations: [{ ...file.automations[0]!, boardId: '' }],
    })

    expect(deps.automationSettings.get(WELCOME_AUTOMATION_ID)?.boardId).toBeNull()
  })

  it('ignores an automation this build has never heard of', () => {
    const deps = build()
    const file = bundle()
    const summary = applyBundle(deps, {
      ...file,
      automations: [
        ...file.automations,
        { id: 'from-the-future', policy: 'AUTO', boardId: '9', enabled: true, templates: [] },
      ],
    })

    expect(summary.automationCount).toBe(1)
    // The unknown entry says it was switched on, and it is not counted: the
    // sentence after an import must not promise something nothing runs.
    expect(summary.enabledCount).toBe(1)
    expect(deps.automationSettings.get('from-the-future')).toBeUndefined()
  })

  it('leaves nothing behind when a write fails part way', () => {
    const deps = build()
    seedConfigured(deps)
    const failing: ConfigTransferDeps = {
      ...deps,
      templates: {
        ...deps.templates,
        replaceAll: () => {
          throw new Error('disk gave out')
        },
      },
    }

    expect(() => applyBundle(failing, bundle())).toThrow('disk gave out')

    // The cafe was written before the templates were reached. If that survived,
    // the install would hold a cafe from the file and templates from before it.
    expect(deps.settings.get('cafeId')).toBe('10000000')
    expect(deps.templates.listAll(WELCOME_AUTOMATION_ID).map((t) => t.body)).toEqual(['개발 문구'])
  })
})

describe('round trip', () => {
  it('reproduces the configuration on the far side', () => {
    const source = build()
    seedConfigured(source)
    const exported = buildBundle(source)

    // A second database standing in for the operator's machine.
    const targetDir = mkdtempSync(join(tmpdir(), 'wm-transfer-target-'))
    try {
      const targetDb = openDatabase(join(targetDir, 'test.db'), { migrationsFolder: MIGRATIONS })
      const target: ConfigTransferDeps = {
        settings: createSettingsRepo(targetDb),
        templates: createTemplatesRepo(targetDb),
        automationSettings: createAutomationSettingsRepo(targetDb),
        transaction: (run) => {
          targetDb.transaction(() => {
            run()
          })
        },
        now: () => NOW,
        newId: () => `imported-${++counter}`,
      }

      applyBundle(target, exported)

      expect(buildBundle(target)).toEqual(exported)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })
})
