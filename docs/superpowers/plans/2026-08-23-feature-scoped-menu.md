# Feature-Scoped Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the UI and settings layers by `automationId` so automations appear as their own menu sections with per-feature approvals, templates and settings, while cafe and account settings stay common.

**Architecture:** The database already keys every table by `automation_id`, so no data model change is needed beyond moving `boardId` from the global `app_settings` key-value table into an `automation_settings.board_id` column. A pure-data catalogue (`src/shared/automations/catalog.ts`) lists what the sidebar renders; a boot-time check makes a catalogue entry without a session runtime throw at startup rather than showing a menu that silently does nothing. No `Automation` behaviour interface is introduced — the 2026-08-22 spec §5.1 defers that until a second automation exists.

**Tech Stack:** TypeScript, Electron 43, React 19, Zustand, drizzle-orm + better-sqlite3, vitest, i18next, Tailwind 4, Vite 8.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-feature-scoped-menu-design.md`. Read it before starting.
- All user-facing text goes through i18next `t(...)`. No hardcoded Korean or English strings in `.tsx` files. Keys live in `src/renderer/locales/ko.ts`.
- All code and code comments in English. Conversation with the user in Korean.
- Immutable updates only — spread/`filter`/`map`, never in-place mutation.
- Files under 800 lines, functions under 50 lines, nesting depth at most 4.
- No `console.log`. (`console.warn`/`console.error` for genuine operational logging matches existing code in `bootstrap.ts` and `background.ts`.)
- Every network request to the cafe goes through the extension bridge. Never add a bare `fetch` in the main process.
- Tests: `pnpm test` (vitest). Type check: `pnpm typecheck`. Lint: `pnpm lint`. All three must pass before each commit.
- Existing test conventions: real SQLite via `mkdtempSync` + `openDatabase(path, { migrationsFolder })`, `FakeClock`/`SequenceRandom` from `tests/fakes.ts`. Follow `tests/desktop/rendererApi.test.ts` for shape.
- Migrations are generated with `pnpm db:generate`, never hand-numbered. The generated SQL file may then be hand-edited to add a backfill statement.

## File Structure

**Phase 1 — data layer (no visible UI change)**

| File | Responsibility |
|---|---|
| `src/desktop/db/schema.ts` | add `boardId` column to `automationSettings` |
| `drizzle/0001_*.sql` | generated migration + hand-added backfill |
| `src/desktop/db/automationSettingsRepo.ts` | read/write `boardId` |
| `src/desktop/session.ts` | read board from automation settings, drop `SETTING_KEYS.boardId` use |
| `src/shared/automations/catalog.ts` | **new** — pure-data catalogue of automations |
| `src/desktop/bootstrap.ts` | runtime registry + boot-time catalogue check |
| `src/desktop/ipc.ts` | IPC channel names and `RendererApi` signature changes |
| `src/desktop/rendererApi.ts` | per-automation methods, common/automation settings split |

**Phase 2 — UI layer**

| File | Responsibility |
|---|---|
| `src/renderer/routes.ts` | **new** — `Route` union and helpers |
| `src/renderer/store.ts` | route-aware state and refresh |
| `src/renderer/App.tsx` | sidebar built from the catalogue, route dispatch |
| `src/renderer/views/AutomationSettings.tsx` | **new** — enabled, policy, board id |
| `src/renderer/views/CommonSettings.tsx` | **new** — cafe, operator accounts, pairing token |
| `src/renderer/views/Settings.tsx` | **deleted** — split into the two above |
| `src/renderer/views/Approvals.tsx` | takes `automationId` prop |
| `src/renderer/views/Templates.tsx` | takes `automationId` prop |
| `src/renderer/views/Dashboard.tsx` | aggregate totals + per-automation rows |
| `src/renderer/locales/ko.ts` | new keys |

---

## Phase 1 — Data layer

### Task 1: Move boardId into automation settings

**Files:**
- Modify: `src/desktop/db/schema.ts:52-57`
- Create: `drizzle/0001_<generated-name>.sql` (via `pnpm db:generate`, then hand-edit)
- Modify: `src/desktop/db/automationSettingsRepo.ts`
- Test: `tests/desktop/db/automationSettingsRepo.test.ts` (create if absent)

**Interfaces:**
- Consumes: `openDatabase(filePath, { migrationsFolder })` from `src/desktop/db/client.ts`; `createSettingsRepo(db)` from `src/desktop/db/settingsRepo.ts`.
- Produces: `AutomationSetting` gains `readonly boardId: string | null`. `AutomationSettingsRepo.get(automationId)` returns it; `upsert(setting)` persists it.

- [ ] **Step 1: Write the failing test**

Create `tests/desktop/db/automationSettingsRepo.test.ts`:

```typescript
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationSettingsRepo } from '../../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-automation-settings-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('automationSettingsRepo boardId', () => {
  it('round-trips a board id', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'AUTO',
      limits: {},
      enabled: true,
      boardId: '5',
    })

    expect(repo.get('welcome-comment')?.boardId).toBe('5')
  })

  it('returns null when the board id was never set', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: null,
    })

    expect(repo.get('welcome-comment')?.boardId).toBeNull()
  })

  it('updates the board id without disturbing policy or enabled', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({
      automationId: 'welcome-comment',
      policy: 'MANUAL',
      limits: {},
      enabled: true,
      boardId: '5',
    })
    const current = repo.get('welcome-comment')
    if (current === undefined) throw new Error('seed failed')
    repo.upsert({ ...current, boardId: '9' })

    const after = repo.get('welcome-comment')
    expect(after?.boardId).toBe('9')
    expect(after?.policy).toBe('MANUAL')
    expect(after?.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/desktop/db/automationSettingsRepo.test.ts`
Expected: FAIL — TypeScript rejects `boardId` because it is not on `AutomationSetting`.

- [ ] **Step 3: Add the column to the schema**

In `src/desktop/db/schema.ts`, replace the `automationSettings` table with:

```typescript
export const automationSettings = sqliteTable('automation_settings', {
  automationId: text('automation_id').primaryKey(),
  policy: text('policy').notNull(),
  limitsJson: text('limits_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  // Nullable: the reader falls back to DEFAULT_BOARD_ID. Adding NOT NULL to an
  // existing SQLite table means rewriting it, which buys nothing here.
  boardId: text('board_id'),
})
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0001_*.sql` containing `ALTER TABLE \`automation_settings\` ADD \`board_id\` text;` and a new entry in `drizzle/meta/_journal.json`.

- [ ] **Step 5: Hand-add the backfill to the generated migration**

Append to the generated `drizzle/0001_*.sql` file:

```sql
--> statement-breakpoint
UPDATE `automation_settings`
SET `board_id` = COALESCE(
  (SELECT `value` FROM `app_settings` WHERE `key` = 'boardId'),
  '5'
)
WHERE `board_id` IS NULL;
```

The literal `'5'` is `DEFAULT_BOARD_ID` from `src/desktop/session.ts`. The `app_settings` row is deliberately left in place so a rollback still has the value.

- [ ] **Step 6: Teach the repo about boardId**

In `src/desktop/db/automationSettingsRepo.ts`, add `boardId` to the interface:

```typescript
export interface AutomationSetting {
  readonly automationId: string
  readonly policy: ApprovalPolicy
  readonly limits: Partial<Limits>
  readonly enabled: boolean
  /** `null` means never configured; the reader falls back to the default board. */
  readonly boardId: string | null
}
```

In `get`, add to the returned object:

```typescript
        boardId: row.boardId,
```

In `upsert`, extend `values` and the conflict `set`:

```typescript
      const values = {
        automationId: setting.automationId,
        policy: setting.policy,
        limitsJson: JSON.stringify(setting.limits),
        enabled: setting.enabled,
        boardId: setting.boardId,
      }
      db.insert(automationSettings)
        .values(values)
        .onConflictDoUpdate({
          target: automationSettings.automationId,
          set: {
            policy: values.policy,
            limitsJson: values.limitsJson,
            enabled: values.enabled,
            boardId: values.boardId,
          },
        })
        .run()
```

- [ ] **Step 7: Fix the other callers of upsert**

`pnpm typecheck` will now fail where `upsert` is called without `boardId`. Fix each:

In `src/desktop/bootstrap.ts`, the seed inside `createAppContext`:

```typescript
    automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
      boardId: null,
    })
```

In `src/desktop/rendererApi.ts`, the `upsert` helper:

```typescript
  const upsert = (patch: Partial<{ policy: ApprovalPolicy; enabled: boolean }>): void => {
    const current = setting()
    repos.automationSettings.upsert({
      automationId,
      policy: patch.policy ?? current?.policy ?? 'AUTO',
      limits: current?.limits ?? {},
      enabled: patch.enabled ?? current?.enabled ?? false,
      boardId: current?.boardId ?? null,
    })
  }
```

Then run `pnpm typecheck` again and fix any test fixtures it flags the same way (add `boardId: null`).

- [ ] **Step 8: Run the tests**

Run: `pnpm test`
Expected: PASS, including the three new `automationSettingsRepo` tests.

- [ ] **Step 9: Verify type check and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both silent.

- [ ] **Step 10: Commit**

```bash
git add src/desktop/db/schema.ts src/desktop/db/automationSettingsRepo.ts drizzle/ \
  src/desktop/bootstrap.ts src/desktop/rendererApi.ts tests/
git commit -m "feat: store the watched board per automation

The 가입인사 board belongs to the welcome-comment automation, not to the
app, so a second automation watching a different board has somewhere to
put it. Backfills from the existing global setting and leaves that key in
place so a rollback still finds it."
```

---

### Task 2: Read the board from automation settings

**Files:**
- Modify: `src/desktop/session.ts:11-16` (SETTING_KEYS), `src/desktop/session.ts:55-60` (board reader)
- Test: `tests/desktop/session.test.ts`

**Interfaces:**
- Consumes: `AutomationSettingsRepo.get(automationId)` returning `boardId: string | null` (Task 1).
- Produces: `SETTING_KEYS` no longer has a `boardId` member. `DEFAULT_BOARD_ID` stays exported from `src/desktop/session.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/desktop/session.test.ts`, inside the existing top-level `describe`:

```typescript
  it('watches the board recorded on the automation, not the global setting', async () => {
    const repos = buildRepos()
    repos.automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: true,
      boardId: '77',
    })
    repos.templates.add({
      id: 't1',
      automationId: WELCOME_AUTOMATION_ID,
      body: '{닉네임}님 환영합니다',
      createdAt: MON_10_00 - 1000,
    })
    const settings = createSettingsRepo(db)
    settings.set(SETTING_KEYS.cafeId, CAFE)

    const seen: string[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'CHECK_LOGIN') {
          seen.push(message.source.boardId)
          return Promise.resolve({
            type: 'LOGIN_STATE',
            requestId: message.requestId,
            loggedIn: true,
            account: 'cafe-ops',
          })
        }
        if (message.type === 'COLLECT') {
          return Promise.resolve({ type: 'COLLECTED', requestId: message.requestId, candidates: [] })
        }
        throw new Error(`unexpected ${message.type}`)
      },
    }

    const run = createSessionRunner({
      automationId: WELCOME_AUTOMATION_ID,
      profile: 'debug',
      clock: new FakeClock(MON_10_00),
      random: new SequenceRandom([0]),
      transport,
      repos,
      settings,
      isKilled: () => false,
      sleep: () => Promise.resolve(),
      newId: () => 'req-1',
    })
    await run()

    expect(seen).toEqual(['77'])
  })
```

If `tests/desktop/session.test.ts` has no `buildRepos()` helper, use whatever helper that file already uses to construct `AppRepos` — read the top of the file and match it exactly rather than inventing a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/desktop/session.test.ts -t 'watches the board recorded'`
Expected: FAIL — `seen` is `['5']` (the default), because the runner still reads the global setting.

- [ ] **Step 3: Read the board from the automation setting**

In `src/desktop/session.ts`, remove `boardId` from `SETTING_KEYS`:

```typescript
export const SETTING_KEYS = {
  cafeId: 'cafeId',
  cafeUrlName: 'cafeUrlName',
  operatorAccounts: 'operatorAccounts',
} as const
```

Then inside `createSessionRunner`, delete the `boardId` closure and read the board from the setting that is already loaded each run. Replace:

```typescript
  const cafeId = () => settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID
  const boardId = () => settings.get(SETTING_KEYS.boardId) ?? DEFAULT_BOARD_ID

  return async function run(): Promise<SessionOutcome> {
    const setting = repos.automationSettings.get(automationId)
    const limits = { ...PROFILES[options.profile], ...(setting?.limits ?? {}) }
    const cafe = cafeId()
    const board = boardId()
```

with:

```typescript
  const cafeId = () => settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID

  return async function run(): Promise<SessionOutcome> {
    const setting = repos.automationSettings.get(automationId)
    const limits = { ...PROFILES[options.profile], ...(setting?.limits ?? {}) }
    const cafe = cafeId()
    const board = setting?.boardId ?? DEFAULT_BOARD_ID
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/desktop/session.test.ts`
Expected: PASS, including the new case and every pre-existing case in the file.

- [ ] **Step 5: Fix remaining references**

Run: `pnpm typecheck`
Expected: failures anywhere `SETTING_KEYS.boardId` is still read — currently `src/desktop/rendererApi.ts` (`getSettings` and `setCafe`). Leave `rendererApi` reading `DEFAULT_BOARD_ID` for now:

In `getSettings`, replace the `boardId` line with:

```typescript
        boardId: setting()?.boardId ?? DEFAULT_BOARD_ID,
```

In `setCafe`, delete the line that writes `SETTING_KEYS.boardId` and drop the now-unused `boardId` parameter's body use — the parameter itself is removed in Task 4, so for now write:

```typescript
    setCafe(cafeId, _boardId, cafeUrlName) {
      settings.set(SETTING_KEYS.cafeId, cafeId.trim())
      settings.set(SETTING_KEYS.cafeUrlName, cafeUrlName.trim())
      return Promise.resolve()
    },
```

Run `pnpm typecheck && pnpm lint` and resolve anything else they flag.

- [ ] **Step 6: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/desktop/session.ts src/desktop/rendererApi.ts tests/desktop/session.test.ts
git commit -m "feat: read the watched board from the automation's own settings

Sessions now take the board from automation_settings rather than the
global key, so two automations can watch different boards."
```

---

### Task 3: Automation catalogue and boot-time runtime check

**Files:**
- Create: `src/shared/automations/catalog.ts`
- Modify: `src/desktop/bootstrap.ts`
- Test: `tests/shared/automations/catalog.test.ts`, `tests/desktop/bootstrap.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `AutomationPanel = 'approvals' | 'templates' | 'settings'`
  - `interface AutomationDescriptor { readonly id: string; readonly labelKey: string; readonly panels: readonly AutomationPanel[] }`
  - `AUTOMATIONS: readonly AutomationDescriptor[]`
  - `findAutomation(id: string): AutomationDescriptor | undefined`
  - `assertRuntimesRegistered(registered: readonly string[]): void` from `src/shared/automations/catalog.ts` — throws when a catalogue entry has no runtime.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/automations/catalog.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  AUTOMATIONS,
  assertRuntimesRegistered,
  findAutomation,
} from '../../../src/shared/automations/catalog.js'

describe('automation catalogue', () => {
  it('lists the welcome comment automation', () => {
    expect(AUTOMATIONS.map((a) => a.id)).toContain('welcome-comment')
  })

  it('gives every entry a distinct id', () => {
    expect(new Set(AUTOMATIONS.map((a) => a.id)).size).toBe(AUTOMATIONS.length)
  })

  it('gives every entry at least one panel', () => {
    for (const automation of AUTOMATIONS) {
      expect(automation.panels.length).toBeGreaterThan(0)
    }
  })

  it('finds an entry by id', () => {
    expect(findAutomation('welcome-comment')?.labelKey).toBe('automation.welcomeComment')
  })

  it('returns undefined for an unknown id', () => {
    expect(findAutomation('nope')).toBeUndefined()
  })
})

describe('assertRuntimesRegistered', () => {
  it('passes when every catalogue entry has a runtime', () => {
    expect(() => assertRuntimesRegistered(AUTOMATIONS.map((a) => a.id))).not.toThrow()
  })

  it('names the automation that has no runtime', () => {
    expect(() => assertRuntimesRegistered([])).toThrow(/welcome-comment/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/shared/automations/catalog.test.ts`
Expected: FAIL — cannot resolve `src/shared/automations/catalog.js`.

- [ ] **Step 3: Write the catalogue**

Create `src/shared/automations/catalog.ts`:

```typescript
/**
 * What the app offers, as data. There is no `Automation` interface and no
 * registry of behaviour here: the 2026-08-22 design spec (§5.1) defers that
 * until a second automation exists, because an interface drawn from one case
 * is usually wrong for the second. This list only says what the sidebar
 * renders and which panels each entry owns.
 */
export type AutomationPanel = 'approvals' | 'templates' | 'settings'

export interface AutomationDescriptor {
  readonly id: string
  readonly labelKey: string
  /**
   * Not every automation has every panel — a periodic notice has nothing to
   * approve, a membership approval has no comment template. Keeping this as
   * data is what stops the navigation from assuming they all look alike.
   */
  readonly panels: readonly AutomationPanel[]
}

export const AUTOMATIONS: readonly AutomationDescriptor[] = [
  {
    id: 'welcome-comment',
    labelKey: 'automation.welcomeComment',
    panels: ['approvals', 'templates', 'settings'],
  },
]

export function findAutomation(id: string): AutomationDescriptor | undefined {
  return AUTOMATIONS.find((automation) => automation.id === id)
}

/**
 * A menu entry whose automation never runs is worse than no entry at all: the
 * operator sees zero executions and cannot tell "nothing to do" from "not
 * running". Rather than warn about that state in the UI, make it impossible to
 * boot into.
 */
export function assertRuntimesRegistered(registered: readonly string[]): void {
  const missing = AUTOMATIONS.filter((automation) => !registered.includes(automation.id))
  if (missing.length > 0) {
    throw new Error(
      `automations have no runtime registered: ${missing.map((a) => a.id).join(', ')}`,
    )
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/shared/automations/catalog.test.ts`
Expected: PASS, all seven cases.

- [ ] **Step 5: Wire the check into bootstrap**

In `src/desktop/bootstrap.ts`, add the import:

```typescript
import { assertRuntimesRegistered } from '../shared/automations/catalog.js'
```

Then, immediately before the `const runSession = createSessionRunner({` line inside `createAppContext`, add:

```typescript
  // The one runtime this build ships. Adding a catalogue entry without adding
  // it here fails the boot, which is the point: the seam where a second
  // automation's runtime gets wired is visible in the code rather than in a
  // developer's memory.
  const RUNTIME_IDS = [WELCOME_AUTOMATION_ID]
  assertRuntimesRegistered(RUNTIME_IDS)
```

- [ ] **Step 6: Verify the boot check runs**

Create `tests/desktop/bootstrap.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { WELCOME_AUTOMATION_ID } from '../../src/desktop/bootstrap.js'
import { AUTOMATIONS, assertRuntimesRegistered } from '../../src/shared/automations/catalog.js'

describe('bootstrap runtime coverage', () => {
  it('ships a runtime for every catalogue entry', () => {
    expect(() => assertRuntimesRegistered([WELCOME_AUTOMATION_ID])).not.toThrow()
  })

  it('keeps the welcome automation id in the catalogue', () => {
    expect(AUTOMATIONS.some((a) => a.id === WELCOME_AUTOMATION_ID)).toBe(true)
  })
})
```

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/shared/automations/catalog.ts src/desktop/bootstrap.ts tests/
git commit -m "feat: list automations as data and refuse to boot without a runtime

The catalogue says what the sidebar renders. The boot check makes a
catalogue entry whose automation never runs impossible to ship, so the UI
never has to explain that state."
```

---

### Task 4: Per-automation renderer API

**Files:**
- Modify: `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts`, `src/desktop/main.ts:95-107`
- Test: `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Consumes: `AUTOMATIONS`, `AutomationPanel` (Task 3); `AutomationSetting.boardId` (Task 1).
- Produces — the new `RendererApi`:
  ```typescript
  getDashboard(): Promise<DashboardSnapshot>
  listAwaiting(automationId: string): Promise<AwaitingItem[]>
  approve(id: string): Promise<void>
  reject(id: string): Promise<void>
  listTemplates(automationId: string): Promise<Template[]>
  addTemplate(automationId: string, body: string): Promise<void>
  removeTemplate(id: string): Promise<void>
  getCommonSettings(): Promise<CommonSettingsView>
  getAutomationSettings(automationId: string): Promise<AutomationSettingsView>
  setPolicy(automationId: string, policy: ApprovalPolicy): Promise<void>
  setEnabled(automationId: string, enabled: boolean): Promise<void>
  setBoardId(automationId: string, boardId: string): Promise<void>
  setOperatorAccounts(accounts: string[]): Promise<void>
  setCafe(cafeId: string, cafeUrlName: string): Promise<void>
  getPairingToken(): Promise<string>
  getCafeImage(): Promise<string | null>
  startAutomation(): Promise<void>
  stopAutomation(): Promise<void>
  killSwitch(): Promise<void>
  runOnce(): Promise<void>
  ```
  and the view types:
  ```typescript
  interface CommonSettingsView {
    readonly cafeId: string
    readonly cafeUrlName: string
    readonly operatorAccounts: string[]
  }
  interface AutomationSettingsView {
    readonly policy: ApprovalPolicy
    readonly enabled: boolean
    readonly boardId: string
  }
  interface AutomationStatus {
    readonly id: string
    readonly enabled: boolean
    readonly awaitingApproval: number
    readonly executedToday: number
    readonly lastOutcome: SessionOutcome | null
  }
  ```
  `DashboardSnapshot` keeps its existing fields and gains `readonly automations: readonly AutomationStatus[]`.

- [ ] **Step 1: Write the failing test**

Add to `tests/desktop/rendererApi.test.ts`. The existing `build()` helper passes `automationId` to `createRendererApi` — remove that argument as part of Step 4; for now write the tests against the new shape:

```typescript
  it('keeps templates separate per automation', async () => {
    const { api } = build()
    await api.addTemplate('welcome-comment', '환영합니다')
    await api.addTemplate('other-automation', '안녕하세요')

    const welcome = await api.listTemplates('welcome-comment')
    const other = await api.listTemplates('other-automation')

    expect(welcome.map((t) => t.body)).toEqual(['환영합니다'])
    expect(other.map((t) => t.body)).toEqual(['안녕하세요'])
  })

  it('keeps policy separate per automation', async () => {
    const { api } = build()
    await api.setPolicy('welcome-comment', 'MANUAL')
    await api.setPolicy('other-automation', 'AUTO')

    expect((await api.getAutomationSettings('welcome-comment')).policy).toBe('MANUAL')
    expect((await api.getAutomationSettings('other-automation')).policy).toBe('AUTO')
  })

  it('round-trips the board id per automation', async () => {
    const { api } = build()
    await api.setBoardId('welcome-comment', '77')

    expect((await api.getAutomationSettings('welcome-comment')).boardId).toBe('77')
    expect((await api.getAutomationSettings('other-automation')).boardId).toBe('5')
  })

  it('reports common settings without a board id', async () => {
    const { api } = build()
    await api.setCafe('999', 'someclub')

    const common = await api.getCommonSettings()
    expect(common.cafeId).toBe('999')
    expect(common.cafeUrlName).toBe('someclub')
    expect('boardId' in common).toBe(false)
  })

  it('reports a status row for every catalogued automation', async () => {
    const { api } = build()
    const dashboard = await api.getDashboard()

    expect(dashboard.automations.map((a) => a.id)).toEqual(AUTOMATIONS.map((a) => a.id))
  })
```

Add the import at the top of the file:

```typescript
import { AUTOMATIONS } from '../../src/shared/automations/catalog.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/desktop/rendererApi.test.ts`
Expected: FAIL — TypeScript rejects the extra arguments and the missing `getAutomationSettings` / `getCommonSettings` / `setBoardId`.

- [ ] **Step 3: Update the IPC contract**

In `src/desktop/ipc.ts`, replace `getSettings` in `IPC_CHANNELS` and add the new channels:

```typescript
export const IPC_CHANNELS = {
  getDashboard: 'wm:getDashboard',
  listAwaiting: 'wm:listAwaiting',
  approve: 'wm:approve',
  reject: 'wm:reject',
  listTemplates: 'wm:listTemplates',
  addTemplate: 'wm:addTemplate',
  removeTemplate: 'wm:removeTemplate',
  getCommonSettings: 'wm:getCommonSettings',
  getAutomationSettings: 'wm:getAutomationSettings',
  getCafeImage: 'wm:getCafeImage',
  setPolicy: 'wm:setPolicy',
  setEnabled: 'wm:setEnabled',
  setBoardId: 'wm:setBoardId',
  setOperatorAccounts: 'wm:setOperatorAccounts',
  setCafe: 'wm:setCafe',
  getPairingToken: 'wm:getPairingToken',
  startAutomation: 'wm:startAutomation',
  stopAutomation: 'wm:stopAutomation',
  killSwitch: 'wm:killSwitch',
  runOnce: 'wm:runOnce',
} as const
```

Replace `SettingsView` with the two view types and add `AutomationStatus`:

```typescript
export interface CommonSettingsView {
  readonly cafeId: string
  /** Vanity url segment, e.g. `examplecafe`; what a person opens the cafe by. */
  readonly cafeUrlName: string
  readonly operatorAccounts: string[]
}

export interface AutomationSettingsView {
  readonly policy: ApprovalPolicy
  readonly enabled: boolean
  readonly boardId: string
}

export interface AutomationStatus {
  readonly id: string
  readonly enabled: boolean
  readonly awaitingApproval: number
  readonly executedToday: number
  readonly lastOutcome: SessionOutcome | null
}
```

Add `automations` to `DashboardSnapshot`:

```typescript
  /** One row per catalogued automation, so "why is it quiet?" is answerable per feature. */
  readonly automations: readonly AutomationStatus[]
```

Then update `RendererApi` to the signature listed under **Interfaces** above.

- [ ] **Step 4: Rewrite the renderer API**

In `src/desktop/rendererApi.ts`:

Remove `automationId` from `RendererApiDeps` and from the destructure. Replace the `setting`/`upsert` helpers with automation-scoped ones:

```typescript
  const { repos, settings } = deps

  const setting = (automationId: string) => repos.automationSettings.get(automationId)

  const upsert = (
    automationId: string,
    patch: Partial<{ policy: ApprovalPolicy; enabled: boolean; boardId: string }>,
  ): void => {
    const current = setting(automationId)
    repos.automationSettings.upsert({
      automationId,
      policy: patch.policy ?? current?.policy ?? 'AUTO',
      limits: current?.limits ?? {},
      enabled: patch.enabled ?? current?.enabled ?? false,
      boardId: patch.boardId ?? current?.boardId ?? null,
    })
  }
```

Rewrite `getDashboard` to sum across the catalogue:

```typescript
    getDashboard(): Promise<DashboardSnapshot> {
      const now = deps.clock.now()
      const since = dailyWindowStart(now, deps.limits, deps.clock)

      const automations = AUTOMATIONS.map((automation) => ({
        id: automation.id,
        enabled: setting(automation.id)?.enabled ?? false,
        awaitingApproval: repos.executions.countByStatus(automation.id, 'AWAITING_APPROVAL'),
        executedToday: repos.executions.countExecutedSince(automation.id, since),
        lastOutcome: deps.lastOutcome(automation.id),
      }))

      const total = (pick: (a: (typeof automations)[number]) => number): number =>
        automations.reduce((sum, a) => sum + pick(a), 0)

      return Promise.resolve({
        bridgeConnected: deps.bridge.isConnected(),
        loopRunning: deps.automation.isRunning(),
        awaitingApproval: total((a) => a.awaitingApproval),
        executedToday: total((a) => a.executedToday),
        succeededToday: AUTOMATIONS.reduce(
          (sum, a) => sum + repos.executions.countByStatusSince(a.id, 'SUCCESS', since),
          0,
        ),
        failedToday: AUTOMATIONS.reduce(
          (sum, a) => sum + repos.executions.countByStatusSince(a.id, 'FAILED', since),
          0,
        ),
        lastOutcome: deps.lastOutcome(WELCOME_AUTOMATION_ID),
        automations,
      })
    },
```

Change `lastOutcome` in `RendererApiDeps` to take an id:

```typescript
  readonly lastOutcome: (automationId: string) => SessionOutcome | null
```

Add the import for the catalogue and the welcome id:

```typescript
import { AUTOMATIONS } from '../shared/automations/catalog.js'
import { WELCOME_AUTOMATION_ID } from './bootstrap.js'
```

Give the remaining methods their `automationId` parameter and split the settings readers:

```typescript
    listAwaiting(automationId) {
      return Promise.resolve(
        repos.executions.listAwaitingDetail(automationId).map((r) => ({
          id: r.id,
          postId: r.targetPostId,
          author: r.targetAuthor,
          title: r.targetTitle,
          renderedText: r.renderedText,
          riskFlags: r.riskFlags,
          detectedAt: r.detectedAt,
        })),
      )
    },

    listTemplates(automationId) {
      return Promise.resolve(repos.templates.listEnabled(automationId))
    },

    addTemplate(automationId, body) {
      const trimmed = body.trim()
      if (trimmed === '') {
        // An empty template would post an empty comment.
        return Promise.reject(new Error('template body must not be blank'))
      }
      repos.templates.add({
        id: deps.newId(),
        automationId,
        body: trimmed,
        createdAt: deps.clock.now(),
      })
      return Promise.resolve()
    },

    getCommonSettings(): Promise<CommonSettingsView> {
      return Promise.resolve({
        cafeId: settings.get(SETTING_KEYS.cafeId) ?? DEFAULT_CAFE_ID,
        cafeUrlName: settings.get(SETTING_KEYS.cafeUrlName) ?? DEFAULT_CAFE_URL_NAME,
        operatorAccounts: parseOperatorAccounts(settings.get(SETTING_KEYS.operatorAccounts)),
      })
    },

    getAutomationSettings(automationId): Promise<AutomationSettingsView> {
      const current = setting(automationId)
      return Promise.resolve({
        policy: current?.policy ?? 'AUTO',
        enabled: current?.enabled ?? false,
        boardId: current?.boardId ?? DEFAULT_BOARD_ID,
      })
    },

    setPolicy(automationId, policy) {
      upsert(automationId, { policy })
      return Promise.resolve()
    },

    setEnabled(automationId, enabled) {
      upsert(automationId, { enabled })
      return Promise.resolve()
    },

    setBoardId(automationId, boardId) {
      upsert(automationId, { boardId: boardId.trim() })
      return Promise.resolve()
    },

    setCafe(cafeId, cafeUrlName) {
      settings.set(SETTING_KEYS.cafeId, cafeId.trim())
      settings.set(SETTING_KEYS.cafeUrlName, cafeUrlName.trim())
      return Promise.resolve()
    },
```

- [ ] **Step 5: Update main.ts**

In `src/desktop/main.ts`, remove `automationId` from the `createRendererApi` call and make `lastOutcome` accept an id. The `AppContext.lastOutcome` currently takes no argument, so wrap it:

```typescript
  registerIpc(
    createRendererApi({
      repos: context.repos,
      settings: context.settings,
      bridge: context.bridge,
      automation: context.automation,
      // Only one automation has a runtime, so its outcome is the only one there
      // is to report. When a second runtime appears this becomes a lookup.
      lastOutcome: (automationId) =>
        automationId === WELCOME_AUTOMATION_ID && context !== null ? context.lastOutcome() : null,
      clock: systemClock,
      limits: PROFILES[profile],
      newId: () => crypto.randomUUID(),
    }),
  )
```

- [ ] **Step 6: Update the test helper**

In `tests/desktop/rendererApi.test.ts`, remove `automationId` from the `createRendererApi(...)` call and change the `lastOutcome` stub:

```typescript
    lastOutcome: () => ({ opened: false, reason: 'NO_TEMPLATE' }),
```

stays valid because the new signature still returns `SessionOutcome | null`; it now simply ignores its argument. Then update every pre-existing call in that file that used the implicit automation — pass `WELCOME_AUTOMATION_ID` (import it from `../../src/desktop/bootstrap.js`, which the file already does).

- [ ] **Step 7: Run tests, type check and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass. If `getSettings` is still referenced anywhere (`src/renderer/api.ts` is typed from `RendererApi`, and `src/renderer/store.ts` calls it), Phase 2 fixes those — for now make the renderer compile by pointing `store.ts`'s `refresh` at `getCommonSettings()` and storing it in the existing `settings` field, and passing `WELCOME_AUTOMATION_ID` to `listAwaiting`/`listTemplates`. Views keep working unchanged because Phase 1 must not alter the UI.

- [ ] **Step 8: Run the app and confirm nothing visibly changed**

```bash
pnpm build:all && ./node_modules/.bin/electron .
```

Expected: the app opens exactly as before — dashboard, approval queue, templates and settings all render and behave as they did. This is the evidence that Phase 1 is correct. Quit the app afterwards.

- [ ] **Step 9: Commit**

```bash
git add src/desktop/ipc.ts src/desktop/rendererApi.ts src/desktop/main.ts src/renderer/store.ts tests/
git commit -m "feat: scope the renderer API by automation

Feature-scoped calls take an automationId, and settings split into the
common set and the per-automation set. The dashboard now reports a row
per catalogued automation alongside the totals."
```

---

## Phase 2 — UI layer

### Task 5: Routes and route-aware store

**Files:**
- Create: `src/renderer/routes.ts`
- Modify: `src/renderer/store.ts`
- Test: `tests/renderer/routes.test.ts`, `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: `AUTOMATIONS`, `AutomationPanel`, `findAutomation` (Task 3); the `RendererApi` from Task 4.
- Produces:
  ```typescript
  type Route =
    | { readonly kind: 'dashboard' }
    | { readonly kind: 'automation'; readonly id: string; readonly panel: AutomationPanel }
    | { readonly kind: 'commonSettings' }
  const DEFAULT_ROUTE: Route
  function routeKey(route: Route): string
  function automationOf(route: Route): string | null
  ```
  Store state: `route`, `dashboard`, `awaiting`, `templates`, `automationSettings`, `commonSettings`, `cafeImage`, `busy`, `error`; actions `setRoute(route)`, `refresh()`, `loadCafeImage()`, `act(run)`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/routes.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, automationOf, routeKey, type Route } from '../../src/renderer/routes.js'

describe('routes', () => {
  it('starts on the dashboard', () => {
    expect(DEFAULT_ROUTE).toEqual({ kind: 'dashboard' })
  })

  it('gives each route a stable key', () => {
    const route: Route = { kind: 'automation', id: 'welcome-comment', panel: 'templates' }
    expect(routeKey(route)).toBe('automation:welcome-comment:templates')
    expect(routeKey({ kind: 'dashboard' })).toBe('dashboard')
    expect(routeKey({ kind: 'commonSettings' })).toBe('commonSettings')
  })

  it('names the automation a route belongs to', () => {
    expect(automationOf({ kind: 'automation', id: 'welcome-comment', panel: 'approvals' })).toBe(
      'welcome-comment',
    )
    expect(automationOf({ kind: 'dashboard' })).toBeNull()
    expect(automationOf({ kind: 'commonSettings' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/renderer/routes.test.ts`
Expected: FAIL — cannot resolve `src/renderer/routes.js`.

- [ ] **Step 3: Write routes.ts**

Create `src/renderer/routes.ts`:

```typescript
import type { AutomationPanel } from '../shared/automations/catalog.js'

export type Route =
  | { readonly kind: 'dashboard' }
  | { readonly kind: 'automation'; readonly id: string; readonly panel: AutomationPanel }
  | { readonly kind: 'commonSettings' }

export const DEFAULT_ROUTE: Route = { kind: 'dashboard' }

/** Stable identity for React keys and for deciding whether a route changed. */
export function routeKey(route: Route): string {
  return route.kind === 'automation' ? `automation:${route.id}:${route.panel}` : route.kind
}

/** The automation a route's data belongs to, or null for app-wide screens. */
export function automationOf(route: Route): string | null {
  return route.kind === 'automation' ? route.id : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/renderer/routes.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 5: Rewrite the store**

Replace `src/renderer/store.ts` with:

```typescript
import { create } from 'zustand'
import type {
  AutomationSettingsView,
  AwaitingItem,
  CommonSettingsView,
  DashboardSnapshot,
} from '../desktop/ipc.js'
import type { Template } from '../shared/types.js'
import { api } from './api.js'
import { DEFAULT_ROUTE, automationOf, type Route } from './routes.js'

interface AppState {
  route: Route
  dashboard: DashboardSnapshot | null
  /** Data for the automation the current route points at, not every automation. */
  awaiting: AwaitingItem[]
  templates: Template[]
  automationSettings: AutomationSettingsView | null
  commonSettings: CommonSettingsView | null
  cafeImage: string | null
  busy: boolean
  /** Message of the last failed action, until the next action starts. */
  error: string | null
  setRoute: (route: Route) => void
  refresh: () => Promise<void>
  loadCafeImage: () => Promise<void>
  act: (run: () => Promise<unknown>) => Promise<boolean>
}

export const useApp = create<AppState>((set, get) => ({
  route: DEFAULT_ROUTE,
  dashboard: null,
  awaiting: [],
  templates: [],
  automationSettings: null,
  commonSettings: null,
  cafeImage: null,
  busy: false,
  error: null,

  setRoute: (route) => {
    set({ route })
    void get().refresh()
  },

  /**
   * Only the current route's automation is fetched. Polling every automation
   * would multiply cafe traffic by the number of features for screens nobody
   * is looking at.
   */
  refresh: async () => {
    const { route } = get()
    const automationId = automationOf(route)
    const dashboard = await api.getDashboard()

    if (automationId === null) {
      const commonSettings = route.kind === 'commonSettings' ? await api.getCommonSettings() : null
      set({ dashboard, ...(commonSettings === null ? {} : { commonSettings }) })
      return
    }

    const [awaiting, templates, automationSettings] = await Promise.all([
      api.listAwaiting(automationId),
      api.listTemplates(automationId),
      api.getAutomationSettings(automationId),
    ])
    set({ dashboard, awaiting, templates, automationSettings })
  },

  loadCafeImage: async () => {
    const cafeImage = await api.getCafeImage()
    set({ cafeImage })
  },

  /**
   * Every mutation refreshes, so the screen never shows stale counts. A
   * failure is recorded rather than rethrown — a silent broken button is the
   * one thing the operator must never get.
   */
  act: async (run) => {
    set({ busy: true, error: null })
    try {
      await run()
      await get().refresh()
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      set({ busy: false })
    }
  },
}))
```

- [ ] **Step 6: Update the store test**

Open `tests/renderer/store.test.ts` and update it to the new shape: the fake `api` must provide `getDashboard`, `listAwaiting`, `listTemplates`, `getAutomationSettings`, `getCommonSettings`, `getCafeImage`. Add a case proving the route decides what is fetched:

```typescript
  it('fetches only the current automation on an automation route', async () => {
    useApp.setState({ route: { kind: 'automation', id: 'welcome-comment', panel: 'approvals' } })
    await useApp.getState().refresh()

    expect(listAwaitingCalls).toEqual(['welcome-comment'])
  })

  it('does not fetch automation data on the dashboard route', async () => {
    useApp.setState({ route: { kind: 'dashboard' } })
    await useApp.getState().refresh()

    expect(listAwaitingCalls).toEqual([])
  })
```

where `listAwaitingCalls` is an array the fake `listAwaiting` pushes its argument onto. Match the mocking style the file already uses.

- [ ] **Step 7: Run tests, type check and lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: routes and store tests pass. `App.tsx` and the views still reference `view`/`setView`/`settings` and will fail type check — Task 6 and Task 7 fix them. If you need a green checkpoint here, do Steps 1-6 and commit after Task 6.

- [ ] **Step 8: Commit (after Task 6 makes the app compile)**

Deferred to Task 6 Step 7 so the tree is never committed in a non-compiling state.

---

### Task 6: Sidebar built from the catalogue

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/locales/ko.ts`
- Test: manual — the app renders

**Interfaces:**
- Consumes: `Route`, `routeKey`, `DEFAULT_ROUTE` (Task 5); `AUTOMATIONS` (Task 3); store `route`/`setRoute` (Task 5).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the i18n keys**

In `src/renderer/locales/ko.ts`, add an `automation` section after `nav` and panel labels inside `nav`:

```typescript
    nav: {
      dashboard: '대시보드',
      approvals: '승인 큐',
      templates: '문구',
      settings: '자동화 설정',
      commonSettings: '카페 · 계정 설정',
      common: '공통',
    },
    automation: {
      welcomeComment: '환영 댓글',
    },
```

- [ ] **Step 2: Rewrite the sidebar**

In `src/renderer/App.tsx`, replace the `VIEWS` constant and the whole `<nav>` body. The imports become:

```typescript
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AUTOMATIONS } from '../shared/automations/catalog.js'
import { routeKey, type Route } from './routes.js'
import { useApp } from './store.js'
import { Approvals } from './views/Approvals.js'
import { AutomationSettings } from './views/AutomationSettings.js'
import { CommonSettings } from './views/CommonSettings.js'
import { Dashboard } from './views/Dashboard.js'
import { Templates } from './views/Templates.js'
```

Read `route`/`setRoute` instead of `view`/`setView`:

```typescript
  const route = useApp((s) => s.route)
  const setRoute = useApp((s) => s.setRoute)
```

Replace the nav buttons with a dashboard entry, one section per automation, and the common settings entry:

```tsx
        <button
          type="button"
          className="nav-item"
          aria-current={route.kind === 'dashboard' ? 'page' : undefined}
          onClick={() => setRoute({ kind: 'dashboard' })}
        >
          <span>{t('nav.dashboard')}</span>
        </button>

        {AUTOMATIONS.map((automation) => (
          <div key={automation.id} className="mt-4 flex flex-col gap-1">
            <div
              className="px-3 pb-1 text-[0.625rem] font-medium uppercase tracking-wider"
              style={{ color: 'var(--ink-muted)' }}
            >
              {t(automation.labelKey)}
            </div>
            {automation.panels.map((panel) => {
              const target: Route = { kind: 'automation', id: automation.id, panel }
              const awaitingCount =
                dashboard?.automations.find((a) => a.id === automation.id)?.awaitingApproval ?? 0
              return (
                <button
                  key={routeKey(target)}
                  type="button"
                  className="nav-item"
                  aria-current={routeKey(route) === routeKey(target) ? 'page' : undefined}
                  onClick={() => setRoute(target)}
                >
                  <span>{t(`nav.${panel}`)}</span>
                  {panel === 'approvals' && awaitingCount > 0 && (
                    <span className="chip">{awaitingCount}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}

        <div className="mt-4 flex flex-col gap-1">
          <div
            className="px-3 pb-1 text-[0.625rem] font-medium uppercase tracking-wider"
            style={{ color: 'var(--ink-muted)' }}
          >
            {t('nav.common')}
          </div>
          <button
            type="button"
            className="nav-item"
            aria-current={route.kind === 'commonSettings' ? 'page' : undefined}
            onClick={() => setRoute({ kind: 'commonSettings' })}
          >
            <span>{t('nav.commonSettings')}</span>
          </button>
        </div>
```

Replace the `<main>` dispatch:

```tsx
        {route.kind === 'dashboard' && <Dashboard />}
        {route.kind === 'commonSettings' && <CommonSettings />}
        {route.kind === 'automation' && route.panel === 'approvals' && (
          <Approvals automationId={route.id} />
        )}
        {route.kind === 'automation' && route.panel === 'templates' && (
          <Templates automationId={route.id} />
        )}
        {route.kind === 'automation' && route.panel === 'settings' && (
          <AutomationSettings automationId={route.id} />
        )}
```

Note the sidebar reads `dashboard` from the store, which `refresh()` fetches on every route — the awaiting badge stays live regardless of which screen is open.

- [ ] **Step 3: Verify type check flags the missing views**

Run: `pnpm typecheck`
Expected: FAIL — `AutomationSettings` and `CommonSettings` do not exist, and `Approvals`/`Templates` do not take props. Task 7 and Task 8 create them.

- [ ] **Step 4: Complete Task 7 and Task 8, then return here**

The sidebar cannot compile alone. Do Task 7 and Task 8 now, then continue at Step 5.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Run the app and click every menu entry**

```bash
pnpm build:all && ./node_modules/.bin/electron .
```

Expected: sidebar shows 대시보드, a 환영 댓글 section with 승인 큐 / 문구 / 자동화 설정, and a 공통 section with 카페 · 계정 설정. Every entry renders its screen. The approval badge appears on 승인 큐 when the queue is non-empty. Quit afterwards.

- [ ] **Step 7: Commit Tasks 5-8 together**

```bash
git add src/renderer/ tests/renderer/
git commit -m "feat: give each automation its own menu section

The sidebar is built from the catalogue, so adding an automation adds its
section. Approvals, templates and automation settings are scoped to the
automation the route names; cafe and account settings stand alone."
```

---

### Task 7: Split the settings screen

**Files:**
- Create: `src/renderer/views/AutomationSettings.tsx`
- Create: `src/renderer/views/CommonSettings.tsx`
- Delete: `src/renderer/views/Settings.tsx`
- Modify: `src/renderer/locales/ko.ts`

**Interfaces:**
- Consumes: store `automationSettings`/`commonSettings`/`busy`/`act` (Task 5); `api.setPolicy`, `api.setEnabled`, `api.setBoardId`, `api.setCafe`, `api.setOperatorAccounts`, `api.getPairingToken` (Task 4).
- Produces: `AutomationSettings({ automationId }: { automationId: string })` and `CommonSettings()`.

- [ ] **Step 1: Add the i18n keys**

In `src/renderer/locales/ko.ts`, restructure the `settings` section:

```typescript
    settings: {
      automationHeading: '자동화 설정',
      commonHeading: '카페 · 계정 설정',
      enabled: '자동화 활성화',
      policy: '승인 정책',
      policyAuto: '무승인 전자동',
      policyAutoHint: '확실한 건만 자동으로 처리하고, 위험 신호가 붙으면 건너뜁니다',
      policySemi: '자동 + 예외 승인',
      policySemiHint: '위험 신호가 붙은 건만 승인 큐로 보냅니다',
      policyManual: '전건 승인',
      policyManualHint: '모든 건을 사람이 확인한 뒤 나갑니다',
      board: '감시 게시판',
      boardId: '게시판 ID',
      boardIdHint: '이 기능이 감시할 게시판입니다. 바꾸면 새 게시판의 새 글부터 다시 시작합니다',
      cafe: '카페',
      cafeId: '카페 ID',
      cafeUrlName: '카페 주소',
      cafeUrlNameHint: '{{url}}',
      operatorAccounts: '운영진 계정',
      operatorAccountsHint: '이 계정 중 누구든 댓글을 달았으면 도구는 손대지 않습니다',
      operatorAccountsPlaceholder: '네이버 계정 ID',
      operatorAccountsAdd: '추가',
      operatorAccountsRemove: '삭제',
      operatorAccountsEmpty: '등록된 운영진 계정이 없습니다',
      pairing: '확장 페어링 토큰',
      pairingHint: '확장 옵션에 이 값을 한 번 붙여넣으면 연결됩니다',
      save: '저장',
    },
```

The old `heading` and `saved` keys are removed; nothing references them after this task.

- [ ] **Step 2: Write AutomationSettings.tsx**

Create `src/renderer/views/AutomationSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApprovalPolicy } from '../../shared/types.js'
import { api } from '../api.js'
import { useApp } from '../store.js'

const POLICIES: ApprovalPolicy[] = ['AUTO', 'SEMI', 'MANUAL']
const POLICY_LABEL: Record<ApprovalPolicy, { label: string; hint: string }> = {
  AUTO: { label: 'settings.policyAuto', hint: 'settings.policyAutoHint' },
  SEMI: { label: 'settings.policySemi', hint: 'settings.policySemiHint' },
  MANUAL: { label: 'settings.policyManual', hint: 'settings.policyManualHint' },
}

interface AutomationSettingsProps {
  readonly automationId: string
}

export function AutomationSettings({ automationId }: AutomationSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.automationSettings)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [boardId, setBoardId] = useState('')

  useEffect(() => {
    if (settings === null) return
    setBoardId(settings.boardId)
  }, [settings])

  if (settings === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  return (
    <div className="flex max-w-2xl flex-col gap-7">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{t('settings.automationHeading')}</h1>
      </header>

      <section className="panel flex items-center justify-between px-5 py-4">
        <span className="text-sm font-medium">{t('settings.enabled')}</span>
        <button
          type="button"
          className={settings.enabled ? 'btn btn-primary' : 'btn'}
          disabled={busy}
          onClick={() => void act(() => api.setEnabled(automationId, !settings.enabled))}
        >
          {t(settings.enabled ? 'status.running' : 'status.stopped')}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.policy')}
        </h2>
        {POLICIES.map((policy) => (
          <button
            key={policy}
            type="button"
            className="panel px-4 py-3 text-left"
            style={settings.policy === policy ? { borderColor: 'var(--accent)' } : undefined}
            disabled={busy}
            onClick={() => void act(() => api.setPolicy(automationId, policy))}
          >
            <div className={`text-sm font-semibold ${settings.policy === policy ? 'tone-warn' : ''}`}>
              {t(POLICY_LABEL[policy].label)}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
              {t(POLICY_LABEL[policy].hint)}
            </div>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.board')}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.boardId')}
          <input className="field" value={boardId} onChange={(e) => setBoardId(e.target.value)} />
          <span className="mt-0.5">{t('settings.boardIdHint')}</span>
        </label>
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={busy}
          onClick={() => void act(() => api.setBoardId(automationId, boardId))}
        >
          {t('settings.save')}
        </button>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Write CommonSettings.tsx**

Create `src/renderer/views/CommonSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api.js'
import { useApp } from '../store.js'

export function CommonSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.commonSettings)
  const busy = useApp((s) => s.busy)
  const act = useApp((s) => s.act)

  const [cafeId, setCafeId] = useState('')
  const [cafeUrlName, setCafeUrlName] = useState('')
  const [accountDraft, setAccountDraft] = useState('')
  const [token, setToken] = useState('')

  useEffect(() => {
    if (settings === null) return
    setCafeId(settings.cafeId)
    setCafeUrlName(settings.cafeUrlName)
  }, [settings])

  useEffect(() => {
    void api.getPairingToken().then(setToken)
  }, [])

  if (settings === null) return <div style={{ color: 'var(--ink-muted)' }}>…</div>

  const addAccount = (): void => {
    const trimmed = accountDraft.trim()
    if (trimmed === '' || settings.operatorAccounts.includes(trimmed)) {
      setAccountDraft('')
      return
    }
    void act(() => api.setOperatorAccounts([...settings.operatorAccounts, trimmed])).then((ok) => {
      if (ok) setAccountDraft('')
    })
  }

  const removeAccount = (account: string): void => {
    void act(() => api.setOperatorAccounts(settings.operatorAccounts.filter((a) => a !== account)))
  }

  return (
    <div className="flex max-w-2xl flex-col gap-7">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{t('settings.commonHeading')}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.cafe')}
        </h2>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.cafeId')}
          <input className="field" value={cafeId} onChange={(e) => setCafeId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.cafeUrlName')}
          <input
            className="field"
            value={cafeUrlName}
            onChange={(e) => setCafeUrlName(e.target.value)}
          />
          <span className="mt-0.5">
            {t('settings.cafeUrlNameHint', { url: `cafe.naver.com/${cafeUrlName}` })}
          </span>
        </label>
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={busy}
          onClick={() => void act(() => api.setCafe(cafeId, cafeUrlName))}
        >
          {t('settings.save')}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.operatorAccounts')}
        </h2>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.operatorAccountsHint')}
        </p>

        <div className="flex gap-2">
          <input
            className="field"
            value={accountDraft}
            placeholder={t('settings.operatorAccountsPlaceholder')}
            onChange={(e) => setAccountDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addAccount()
            }}
          />
          <button type="button" className="btn shrink-0" disabled={busy} onClick={addAccount}>
            {t('settings.operatorAccountsAdd')}
          </button>
        </div>

        {settings.operatorAccounts.length === 0 ? (
          <div className="panel px-4 py-3 text-xs tone-warn">
            {t('settings.operatorAccountsEmpty')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {settings.operatorAccounts.map((account) => (
              <li key={account} className="panel flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm">{account}</span>
                <button
                  type="button"
                  className="btn btn-danger shrink-0"
                  disabled={busy}
                  onClick={() => removeAccount(account)}
                >
                  {t('settings.operatorAccountsRemove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('settings.pairing')}
        </h2>
        <code
          className="panel select-all break-all px-4 py-3 font-mono text-xs"
          style={{ background: 'var(--surface-sunken)' }}
        >
          {token}
        </code>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {t('settings.pairingHint')}
        </span>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Delete the old screen**

```bash
git rm src/renderer/views/Settings.tsx
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck`
Expected: the only remaining failures are `Approvals`/`Templates` not taking props (Task 8).

---

### Task 8: Scope approvals and templates to an automation

**Files:**
- Modify: `src/renderer/views/Approvals.tsx`, `src/renderer/views/Templates.tsx`

**Interfaces:**
- Consumes: `api.approve`, `api.reject`, `api.addTemplate(automationId, body)`, `api.removeTemplate` (Task 4); store `awaiting`/`templates`/`busy`/`act` (Task 5).
- Produces: `Approvals({ automationId }: { automationId: string })`, `Templates({ automationId }: { automationId: string })`.

- [ ] **Step 1: Give Approvals its prop**

In `src/renderer/views/Approvals.tsx`, change the signature and leave the body as it is — `approve`/`reject` take a globally unique execution id and need no automation:

```tsx
interface ApprovalsProps {
  readonly automationId: string
}

export function Approvals({ automationId }: ApprovalsProps): React.JSX.Element {
```

Because nothing in the body uses `automationId`, prefix it to satisfy the linter's unused-argument rule only if `pnpm lint` complains; otherwise leave it named. The prop exists so the parent route is the single source of truth for which automation is on screen, and so a future per-automation empty state has it.

If `pnpm lint` flags it as unused, take the prop but don't destructure it:

```tsx
export function Approvals(_props: ApprovalsProps): React.JSX.Element {
```

- [ ] **Step 2: Give Templates its prop and use it**

In `src/renderer/views/Templates.tsx`:

```tsx
interface TemplatesProps {
  readonly automationId: string
}

export function Templates({ automationId }: TemplatesProps): React.JSX.Element {
```

and change the submit handler to pass it:

```tsx
  const submit = (): void => {
    const body = draft.trim()
    if (body === '') return
    void act(() => api.addTemplate(automationId, body)).then((ok) => {
      // A failed add keeps the draft so the operator does not retype it.
      if (ok) setDraft('')
    })
  }
```

- [ ] **Step 3: Verify, then return to Task 6 Step 5**

Run: `pnpm typecheck && pnpm lint`
Expected: both silent. Now go back to Task 6 Step 5 and finish the shared commit.

---

### Task 9: Per-automation dashboard rows

**Files:**
- Modify: `src/renderer/views/Dashboard.tsx`
- Modify: `src/renderer/locales/ko.ts`

**Interfaces:**
- Consumes: `DashboardSnapshot.automations: readonly AutomationStatus[]` (Task 4); `AUTOMATIONS`, `findAutomation` (Task 3); `outcomeSummary` from `src/renderer/format.js`; store `setRoute` (Task 5).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the i18n keys**

In `src/renderer/locales/ko.ts`, add to the `dashboard` section:

```typescript
    dashboard: {
      heading: '대시보드',
      automations: '기능별 상태',
      awaitingShort: '대기 {{count}}건',
    },
```

- [ ] **Step 2: Render a row per automation**

In `src/renderer/views/Dashboard.tsx`, add the imports:

```typescript
import { findAutomation } from '../../shared/automations/catalog.js'
```

and append a section after the existing `<section className="grid grid-cols-4 gap-3">` block:

```tsx
      <section className="flex flex-col gap-2">
        <h2
          className="text-[0.6875rem] font-medium uppercase tracking-wider"
          style={{ color: 'var(--ink-muted)' }}
        >
          {t('dashboard.automations')}
        </h2>
        {dashboard.automations.map((automation) => {
          const descriptor = findAutomation(automation.id)
          const rowSummary = outcomeSummary(automation.lastOutcome)
          return (
            <button
              key={automation.id}
              type="button"
              className="panel flex items-center justify-between gap-4 px-4 py-3 text-left"
              onClick={() =>
                setRoute({ kind: 'automation', id: automation.id, panel: 'settings' })
              }
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full bar-${rowSummary.tone}`} />
                  <span className="text-sm font-semibold">
                    {descriptor === undefined ? automation.id : t(descriptor.labelKey)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {t(rowSummary.key, { count: rowSummary.count ?? 0 })}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {automation.awaitingApproval > 0 && (
                  <span className="chip tone-warn">
                    {t('dashboard.awaitingShort', { count: automation.awaitingApproval })}
                  </span>
                )}
                <span className={automation.enabled ? 'tone-ok' : 'tone-idle'}>
                  {t(automation.enabled ? 'status.running' : 'status.stopped')}
                </span>
              </div>
            </button>
          )
        })}
      </section>
```

Read `setRoute` at the top of the component alongside the existing selectors:

```typescript
  const setRoute = useApp((s) => s.setRoute)
```

- [ ] **Step 3: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 4: Run the app and check the dashboard**

```bash
pnpm build:all && ./node_modules/.bin/electron .
```

Expected: the dashboard shows the totals row as before, plus a 기능별 상태 section with one clickable row for 환영 댓글 showing its state and enabled flag. Clicking the row opens that automation's settings. Quit afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/Dashboard.tsx src/renderer/locales/ko.ts
git commit -m "feat: show each automation's state on the dashboard

Totals stay on top; a row per automation answers 'why is this one quiet?'
without opening its screen, and clicking a row goes to its settings."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §3 catalogue | Task 3 |
| §4 settings split | Task 1 (schema), Task 2 (session), Task 4 (API), Task 7 (UI) |
| §4.1 migration + backfill | Task 1 Steps 4-5 |
| §5 navigation | Task 5 (routes), Task 6 (sidebar) |
| §6 catalogue/runtime check | Task 3 Steps 3, 5, 6 |
| §7 IPC | Task 4 |
| §8 dashboard | Task 4 (data), Task 9 (UI) |
| §9 renderer state | Task 5 |
| §10 view composition | Task 7, Task 8 |
| §11 two phases | Phase 1 = Tasks 1-4, Phase 2 = Tasks 5-9 |
| §12 tests | Task 1, 2, 3, 4, 5 each carry their listed tests |

**Known sequencing quirk:** Tasks 5-8 land in one commit because the renderer does not compile between them. Task 6 Step 4 routes the implementer through 7 and 8 before returning. This is deliberate — the alternative is committing a tree that fails `pnpm typecheck`.

**Phase 1 acceptance:** after Task 4, the app must look and behave exactly as it did before. If anything on screen changed, Phase 1 did something it should not have.
