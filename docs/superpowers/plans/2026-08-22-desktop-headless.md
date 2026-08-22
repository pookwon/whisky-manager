# 데스크톱 헤드리스 계층 구현 계획 (Phase 4 — C1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세션이 스스로 반복 구동되고, 워터마크·재시도·승인·만료가 영속화되며, 트레이에서 켜고 끌 수 있는 상태까지 만든다. 렌더러 UI 없이 전부 단위 테스트로 검증한다.

**Architecture:** 기존 `runSession`(Phase 2)을 그대로 두되, 그것을 반복 호출하는 **세션 루프**와 그 주변의 영속 계층을 붙인다. 판단은 여전히 `src/shared`의 순수 함수가 하고, `src/desktop`은 그것을 DB·타이머·Electron에 배선하기만 한다.

**Tech Stack:** Electron 43, better-sqlite3 13, Drizzle 0.45, TypeScript 5.9, Vitest 4

**선행:** `docs/superpowers/plans/2026-08-22-naver-cafe-foundation.md` (Phase 0~2) 완료
**설계 근거:** `docs/superpowers/specs/2026-08-22-naver-cafe-automation-design.md`

## 이 계획이 닫는 스펙 누락

Phase 2 구현에는 스펙 5.8절의 요구 하나가 빠져 있다.

> **확인 시점과 실행 시점 사이에 경합이 있다.** 수집 시점에 댓글이 없었어도 실행 직전에 스태프가 달 수 있다. 따라서 **실행 직전에 한 번 더 확인**한다.

현재는 수집 응답에 실린 `existingCommentAuthors`만 본다. 세션 내 간격이 8~25초이므로 창은 짧지만 0이 아니고, 사람과 도구가 같은 게시판을 나눠 처리하는 Phase 5 램프업에서는 실제로 부딪힌다. Task 2가 이를 닫는다.

## Global Constraints

Phase 0~2의 제약을 모두 승계한다. 추가로:

- 세션 루프는 **앱이 소유**한다. 확장에는 여전히 재연결 알람 외의 타이머가 없다
- 재시도는 **같은 텍스트를 다시 보낸다.** 재렌더링하지 않는다 — 템플릿이 여러 개일 때 재시도마다 문구가 바뀌면 사람이 한 행동으로 보이지 않고, 무엇이 나갈지도 예측할 수 없다
- 워터마크는 **처리를 마친 글까지만** 전진시킨다. 수집 직후 전진시키면 앱이 중간에 죽었을 때 그 사이 글을 영원히 놓친다
- `debug` 프로파일은 개발 빌드에서만 선택 가능하다. 프로덕션 인스톨러에는 노출하지 않는다

## File Structure

이 계획이 추가하는 파일만 표시한다.

```
src/shared/
├── templates.ts            템플릿 선택·치환 (순수)
src/desktop/
├── db/settingsRepo.ts      app_settings
├── db/templatesRepo.ts     templates
├── db/automationSettingsRepo.ts
├── db/watermarksRepo.ts
├── approvals.ts            승인·거부·만료 스윕
├── retries.ts              RETRY_WAIT → QUEUED 승격
├── sessionLoop.ts          스케줄러 구동, 킬 스위치
├── runtime.ts              실제 Clock / Random 구현
├── bootstrap.ts            앱 조립
├── ipc.ts                  렌더러가 쓸 계약 (C2에서 UI가 붙음)
├── main.ts                 Electron 엔트리 — 창, 트레이, 자동 시작
└── preload.ts
tests/shared/templates.test.ts
tests/desktop/{approvals,retries,sessionLoop,runtime}.test.ts
tests/desktop/db/{settingsRepo,templatesRepo,watermarksRepo,automationSettingsRepo}.test.ts
```

---

### Task 1: 템플릿 선택과 치환

**Files:**
- Create: `src/shared/templates.ts`
- Create: `tests/shared/templates.test.ts`
- Modify: `src/shared/index.ts`

**Interfaces:**
- Consumes: `Template` (Phase 2 `types.ts`), `Random` (`ports.ts`)
- Produces:
  - `pickTemplate(templates: readonly Template[], random: Random): Template | null`
  - `RenderResult = { ok: true; text: string } | { ok: false; missing: string[] }`
  - `renderTemplate(body: string, vars: Readonly<Record<string, string>>): RenderResult`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/shared/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pickTemplate, renderTemplate } from '../../src/shared/templates.js'
import type { Template } from '../../src/shared/types.js'
import { SequenceRandom } from '../fakes.js'

const one: Template = { id: 't1', body: '{닉네임}님 환영합니다' }
const two: Template = { id: 't2', body: '{닉네임}님 반갑습니다' }
const three: Template = { id: 't3', body: '{닉네임}님 어서오세요' }

describe('pickTemplate', () => {
  it('returns null when nothing is registered', () => {
    expect(pickTemplate([], new SequenceRandom([0]))).toBeNull()
  })

  it('returns the single template without consulting randomness', () => {
    expect(pickTemplate([one], new SequenceRandom([99]))).toEqual(one)
  })

  it('draws uniformly across the index range when several are registered', () => {
    expect(pickTemplate([one, two, three], new SequenceRandom([0]))).toEqual(one)
    expect(pickTemplate([one, two, three], new SequenceRandom([2]))).toEqual(three)
  })
})

describe('renderTemplate', () => {
  it('substitutes a known variable', () => {
    expect(renderTemplate('{닉네임}님 환영합니다', { 닉네임: '신입회원' })).toEqual({
      ok: true,
      text: '신입회원님 환영합니다',
    })
  })

  it('substitutes every occurrence', () => {
    expect(renderTemplate('{닉네임}님, {닉네임}님', { 닉네임: 'A' })).toEqual({ ok: true, text: 'A님, A님' })
  })

  it('reports missing variables instead of leaving the placeholder in the text', () => {
    expect(renderTemplate('{닉네임}님 {등급} 환영', { 닉네임: 'A' })).toEqual({ ok: false, missing: ['등급'] })
  })

  it('reports an empty value as missing', () => {
    // A blank nickname would post "님 환영합니다", which reads as broken.
    expect(renderTemplate('{닉네임}님 환영', { 닉네임: '' })).toEqual({ ok: false, missing: ['닉네임'] })
  })

  it('passes through a body with no placeholders', () => {
    expect(renderTemplate('환영합니다', {})).toEqual({ ok: true, text: '환영합니다' })
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import "../../src/shared/templates.js"`

- [ ] **Step 3: 구현**

`src/shared/templates.ts`:

```ts
import type { Random } from './ports.js'
import type { Template } from './types.js'

const PLACEHOLDER = /\{([^{}]+)\}/g

/**
 * One registered template means that template; several means a uniform draw.
 * The operator controls variety by how many they register, not by a mode flag.
 */
export function pickTemplate(templates: readonly Template[], random: Random): Template | null {
  if (templates.length === 0) return null
  if (templates.length === 1) return templates[0] ?? null
  const index = random.intInclusive(0, templates.length - 1)
  return templates[index] ?? null
}

export type RenderResult = { ok: true; text: string } | { ok: false; missing: string[] }

/**
 * Substitution fails loudly rather than posting a half-filled template. An
 * empty value counts as missing: "님 환영합니다" reads as broken to a member.
 */
export function renderTemplate(body: string, vars: Readonly<Record<string, string>>): RenderResult {
  const missing: string[] = []

  const text = body.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim()
    const value = vars[name]
    if (value === undefined || value === '') {
      if (!missing.includes(name)) missing.push(name)
      return ''
    }
    return value
  })

  return missing.length > 0 ? { ok: false, missing } : { ok: true, text }
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

`src/shared/index.ts`에 `export * from './templates.js'` 추가.

```bash
git add -A
git commit -m "feat: add template selection and variable substitution"
```

---

### Task 2: 실행 직전 중복 재확인

**Files:**
- Modify: `src/shared/protocol.ts` (`CHECK_COMMENTS` / `COMMENTS` 메시지)
- Modify: `src/desktop/orchestrator.ts`
- Modify: `tests/shared/protocol.test.ts`, `tests/desktop/orchestrator.test.ts`

**Interfaces:**
- Produces:
  - `AppMessage`에 `{ type: 'CHECK_COMMENTS'; requestId: string; automationId: string; action: { cafeId; boardId; postId } }` 추가
  - `ExtensionMessage`에 `{ type: 'COMMENTS'; requestId: string; authors: string[] | null }` 추가
  - `TIMEOUTS.commentCheckMs = 10_000`
  - `SessionOutcome`의 `skipped`에 실행 직전 스킵이 합산된다

- [ ] **Step 1: 프로토콜 테스트 추가**

`tests/shared/protocol.test.ts`의 `describe('timeouts', ...)` 안에 추가:

```ts
  it('bounds the pre-execution comment re-check', () => {
    expect(TIMEOUTS.commentCheckMs).toBe(10_000)
    expect(TIMEOUTS.commentCheckMs).toBeLessThan(30_000)
  })
```

`describe('isAppMessage', ...)` 안에 추가:

```ts
  it('accepts a CHECK_COMMENTS message', () => {
    expect(
      isAppMessage({
        type: 'CHECK_COMMENTS',
        requestId: 'r9',
        automationId: 'welcome-comment',
        action: { cafeId: '10000000', boardId: '5', postId: '1001' },
      }),
    ).toBe(true)
  })
```

`describe('isExtensionMessage', ...)` 안에 추가:

```ts
  it('accepts a COMMENTS reply', () => {
    expect(isExtensionMessage({ type: 'COMMENTS', requestId: 'r9', authors: ['cafe-ops'] })).toBe(true)
  })
```

- [ ] **Step 2: 오케스트레이터 테스트 추가**

`tests/desktop/orchestrator.test.ts`의 `FakeTransportOptions`에 필드를 더한다:

```ts
interface FakeTransportOptions {
  loggedIn?: boolean
  candidates?: RawCandidate[]
  executeOk?: boolean
  /** Authors returned by the pre-execution re-check. `undefined` means none. */
  commentsAtExecution?: string[] | null
}
```

`fakeTransport`의 `request` 안, `EXECUTE` 분기 **앞에** 추가:

```ts
      if (message.type === 'CHECK_COMMENTS') {
        return Promise.resolve({
          type: 'COMMENTS',
          requestId: message.requestId,
          authors: options.commentsAtExecution === undefined ? [] : options.commentsAtExecution,
        })
      }
```

그리고 새 describe 블록을 파일 끝에 추가:

```ts
describe('runSession — pre-execution re-check', () => {
  it('skips when an operator commented between collection and execution', async () => {
    // Collection saw no comments, but a staff member got there first.
    const transport = fakeTransport({ candidates: [candidate('7001')], commentsAtExecution: ['cafe-ops'] })

    const outcome = await runSession(deps({ transport }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1 })

    const rows = db.select().from(executions).all()
    expect(rows[0]?.status).toBe('SKIPPED')
    expect(rows[0]?.reason).toBe('ALREADY_COMMENTED')
  })

  it('executes when the re-check finds no operator comment', async () => {
    const transport = fakeTransport({ candidates: [candidate('7002')], commentsAtExecution: [] })
    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 1, skipped: 0 })
  })

  it('does not execute when the re-check itself fails', async () => {
    // Posting without knowing is worse than not posting.
    const transport = fakeTransport({ candidates: [candidate('7003')], commentsAtExecution: null })

    const outcome = await runSession(deps({ transport }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1 })

    const rows = db.select().from(executions).all()
    expect(rows[0]?.reason).toBe('COMMENT_CHECK_FAILED')
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `CHECK_COMMENTS` 미정의로 프로토콜 테스트가, 재확인 미구현으로 오케스트레이터 테스트가 깨진다.

- [ ] **Step 4: 프로토콜 확장**

`src/shared/protocol.ts`의 `TIMEOUTS`에 추가:

```ts
  commentCheckMs: 10_000,
```

`ActionEnvelope` 아래에 추가:

```ts
export interface PostRef {
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
}
```

`AppMessage` 유니온에 추가:

```ts
  | { type: 'CHECK_COMMENTS'; requestId: string; automationId: string; action: PostRef }
```

`ExtensionMessage` 유니온에 추가:

```ts
  | { type: 'COMMENTS'; requestId: string; authors: string[] | null }
```

두 `Set` 리터럴에도 각각 `'CHECK_COMMENTS'`, `'COMMENTS'`를 더한다.

- [ ] **Step 5: 오케스트레이터에 재확인 삽입**

`src/desktop/orchestrator.ts`에 헬퍼를 추가한다 (`execute` 함수 위):

```ts
/**
 * Re-reads the post's comments immediately before writing. Collection may be
 * seconds old, and in parallel operation a staff member can get there first.
 * `null` means the check could not be performed.
 */
async function recheckComments(deps: SessionDeps, candidate: Candidate): Promise<string[] | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'CHECK_COMMENTS',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        action: { cafeId: candidate.cafeId, boardId: candidate.boardId, postId: candidate.postId },
      },
      TIMEOUTS.commentCheckMs,
    )
    return reply.type === 'COMMENTS' ? reply.authors : null
  } catch {
    return null
  }
}
```

그리고 `deps.sleep(...)` 호출 **바로 다음**, `const rendered = deps.renderBody(candidate)` **앞에** 삽입한다:

```ts
    const authorsNow = await recheckComments(deps, candidate)
    if (authorsNow === null) {
      deps.repo.applyPatch(executionId, {
        status: 'SKIPPED',
        reason: 'COMMENT_CHECK_FAILED',
        riskFlags: evaluation.flags,
        resolvedAt: deps.clock.now(),
      })
      skipped += 1
      continue
    }
    if (authorsNow.some((author) => deps.operatorAccounts.includes(author))) {
      deps.repo.applyPatch(executionId, {
        status: 'SKIPPED',
        reason: 'ALREADY_COMMENTED',
        riskFlags: evaluation.flags,
        resolvedAt: deps.clock.now(),
      })
      skipped += 1
      continue
    }
```

재확인을 대기 **뒤에** 두는 것이 중요하다. 대기 전에 확인하면 8~25초의 창이 그대로 남는다.

- [ ] **Step 6: 확장 스텁도 응답하도록 수정**

`src/extension/background.ts`의 `handle` switch에 `EXECUTE` 분기 앞에 추가:

```ts
    case 'CHECK_COMMENTS':
      send({ type: 'COMMENTS', requestId: message.requestId, authors: [] })
      return
```

- [ ] **Step 7: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm build:extension
```

```bash
git add -A
git commit -m "feat: re-check comments immediately before executing"
```

---

### Task 3: 설정·템플릿·워터마크 저장소

**Files:**
- Create: `src/desktop/db/settingsRepo.ts`, `src/desktop/db/templatesRepo.ts`, `src/desktop/db/automationSettingsRepo.ts`, `src/desktop/db/watermarksRepo.ts`
- Test: `tests/desktop/db/repos.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (Phase 2), `Template`, `ApprovalPolicy`, `Limits`
- Produces:
  - `SettingsRepo { get(key): string | undefined; set(key, value): void }`, `createSettingsRepo(db)`
  - `TemplatesRepo { listEnabled(automationId): Template[]; add(input): void; setEnabled(id, enabled): void; remove(id): void }`, `createTemplatesRepo(db)`
  - `AutomationSetting { automationId; policy; limits: Partial<Limits>; enabled }`
  - `AutomationSettingsRepo { get(automationId): AutomationSetting | undefined; upsert(setting): void }`, `createAutomationSettingsRepo(db)`
  - `WatermarksRepo { get(automationId, cafeId, boardId): string | null; set(automationId, cafeId, boardId, postId, updatedAt): void }`, `createWatermarksRepo(db)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/desktop/db/repos.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAutomationSettingsRepo } from '../../../src/desktop/db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createSettingsRepo } from '../../../src/desktop/db/settingsRepo.js'
import { createTemplatesRepo } from '../../../src/desktop/db/templatesRepo.js'
import { createWatermarksRepo } from '../../../src/desktop/db/watermarksRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-repos-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('settingsRepo', () => {
  it('returns undefined for an unknown key', () => {
    expect(createSettingsRepo(db).get('nope')).toBeUndefined()
  })

  it('round-trips a value', () => {
    const repo = createSettingsRepo(db)
    repo.set('pairingToken', 'abc')
    expect(repo.get('pairingToken')).toBe('abc')
  })

  it('overwrites an existing key rather than failing', () => {
    const repo = createSettingsRepo(db)
    repo.set('profile', 'production')
    repo.set('profile', 'debug')
    expect(repo.get('profile')).toBe('debug')
  })
})

describe('templatesRepo', () => {
  it('lists only enabled templates for the automation', () => {
    const repo = createTemplatesRepo(db)
    repo.add({ id: 't1', automationId: 'welcome-comment', body: 'a', createdAt: 1 })
    repo.add({ id: 't2', automationId: 'welcome-comment', body: 'b', createdAt: 2 })
    repo.add({ id: 't3', automationId: 'other', body: 'c', createdAt: 3 })
    repo.setEnabled('t2', false)

    expect(repo.listEnabled('welcome-comment')).toEqual([{ id: 't1', body: 'a' }])
  })

  it('removes a template', () => {
    const repo = createTemplatesRepo(db)
    repo.add({ id: 't1', automationId: 'welcome-comment', body: 'a', createdAt: 1 })
    repo.remove('t1')
    expect(repo.listEnabled('welcome-comment')).toEqual([])
  })
})

describe('automationSettingsRepo', () => {
  it('returns undefined before anything is stored', () => {
    expect(createAutomationSettingsRepo(db).get('welcome-comment')).toBeUndefined()
  })

  it('round-trips policy, limit overrides and the enabled flag', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({ automationId: 'welcome-comment', policy: 'SEMI', limits: { dailyCap: 50 }, enabled: false })

    expect(repo.get('welcome-comment')).toEqual({
      automationId: 'welcome-comment',
      policy: 'SEMI',
      limits: { dailyCap: 50 },
      enabled: false,
    })
  })

  it('overwrites on a second upsert', () => {
    const repo = createAutomationSettingsRepo(db)
    repo.upsert({ automationId: 'welcome-comment', policy: 'MANUAL', limits: {}, enabled: true })
    repo.upsert({ automationId: 'welcome-comment', policy: 'AUTO', limits: {}, enabled: true })
    expect(repo.get('welcome-comment')?.policy).toBe('AUTO')
  })
})

describe('watermarksRepo', () => {
  it('returns null before anything is recorded', () => {
    expect(createWatermarksRepo(db).get('welcome-comment', '10000000', '5')).toBeNull()
  })

  it('round-trips a watermark per cafe and board', () => {
    const repo = createWatermarksRepo(db)
    repo.set('welcome-comment', '10000000', '5', '1005', 100)
    repo.set('welcome-comment', '99999999', '5', '2005', 100)

    expect(repo.get('welcome-comment', '10000000', '5')).toBe('1005')
    expect(repo.get('welcome-comment', '99999999', '5')).toBe('2005')
  })

  it('advances an existing watermark', () => {
    const repo = createWatermarksRepo(db)
    repo.set('welcome-comment', '10000000', '5', '1005', 100)
    repo.set('welcome-comment', '10000000', '5', '1010', 200)
    expect(repo.get('welcome-comment', '10000000', '5')).toBe('1010')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — 네 저장소 모듈이 없다.

- [ ] **Step 3: 구현**

`src/desktop/db/settingsRepo.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { AppDatabase } from './client.js'
import { appSettings } from './schema.js'

export interface SettingsRepo {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

export function createSettingsRepo(db: AppDatabase): SettingsRepo {
  return {
    get(key) {
      return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value
    },
    set(key, value) {
      db.insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value } })
        .run()
    },
  }
}
```

`src/desktop/db/templatesRepo.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'
import type { Template } from '../../shared/types.js'
import type { AppDatabase } from './client.js'
import { templates } from './schema.js'

export interface AddTemplateInput {
  readonly id: string
  readonly automationId: string
  readonly body: string
  readonly createdAt: number
}

export interface TemplatesRepo {
  listEnabled(automationId: string): Template[]
  add(input: AddTemplateInput): void
  setEnabled(id: string, enabled: boolean): void
  remove(id: string): void
}

export function createTemplatesRepo(db: AppDatabase): TemplatesRepo {
  return {
    listEnabled(automationId) {
      return db
        .select()
        .from(templates)
        .where(and(eq(templates.automationId, automationId), eq(templates.enabled, true)))
        .orderBy(asc(templates.createdAt))
        .all()
        .map((r) => ({ id: r.id, body: r.body }))
    },
    add(input) {
      db.insert(templates)
        .values({
          id: input.id,
          automationId: input.automationId,
          body: input.body,
          enabled: true,
          createdAt: input.createdAt,
        })
        .run()
    },
    setEnabled(id, enabled) {
      db.update(templates).set({ enabled }).where(eq(templates.id, id)).run()
    },
    remove(id) {
      db.delete(templates).where(eq(templates.id, id)).run()
    },
  }
}
```

`src/desktop/db/automationSettingsRepo.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { ApprovalPolicy, Limits } from '../../shared/types.js'
import type { AppDatabase } from './client.js'
import { automationSettings } from './schema.js'

export interface AutomationSetting {
  readonly automationId: string
  readonly policy: ApprovalPolicy
  readonly limits: Partial<Limits>
  readonly enabled: boolean
}

export interface AutomationSettingsRepo {
  get(automationId: string): AutomationSetting | undefined
  upsert(setting: AutomationSetting): void
}

function parseLimits(raw: string): Partial<Limits> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<Limits>) : {}
  } catch {
    return {}
  }
}

export function createAutomationSettingsRepo(db: AppDatabase): AutomationSettingsRepo {
  return {
    get(automationId) {
      const row = db
        .select()
        .from(automationSettings)
        .where(eq(automationSettings.automationId, automationId))
        .get()
      if (row === undefined) return undefined
      return {
        automationId: row.automationId,
        policy: row.policy as ApprovalPolicy,
        limits: parseLimits(row.limitsJson),
        enabled: row.enabled,
      }
    },
    upsert(setting) {
      const values = {
        automationId: setting.automationId,
        policy: setting.policy,
        limitsJson: JSON.stringify(setting.limits),
        enabled: setting.enabled,
      }
      db.insert(automationSettings)
        .values(values)
        .onConflictDoUpdate({
          target: automationSettings.automationId,
          set: { policy: values.policy, limitsJson: values.limitsJson, enabled: values.enabled },
        })
        .run()
    },
  }
}
```

`src/desktop/db/watermarksRepo.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from './client.js'
import { watermarks } from './schema.js'

export interface WatermarksRepo {
  get(automationId: string, cafeId: string, boardId: string): string | null
  set(automationId: string, cafeId: string, boardId: string, lastSeenPostId: string, updatedAt: number): void
}

export function createWatermarksRepo(db: AppDatabase): WatermarksRepo {
  return {
    get(automationId, cafeId, boardId) {
      const row = db
        .select()
        .from(watermarks)
        .where(
          and(
            eq(watermarks.automationId, automationId),
            eq(watermarks.cafeId, cafeId),
            eq(watermarks.boardId, boardId),
          ),
        )
        .get()
      return row?.lastSeenPostId ?? null
    },
    set(automationId, cafeId, boardId, lastSeenPostId, updatedAt) {
      db.insert(watermarks)
        .values({ automationId, cafeId, boardId, lastSeenPostId, updatedAt })
        .onConflictDoUpdate({
          target: [watermarks.cafeId, watermarks.automationId, watermarks.boardId],
          set: { lastSeenPostId, updatedAt },
        })
        .run()
    },
  }
}
```

- [ ] **Step 4: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add -A
git commit -m "feat: add settings, templates, automation settings and watermark repositories"
```

---

### Task 4: 워터마크 전진

**Files:**
- Create: `src/shared/postId.ts`
- Modify: `src/desktop/orchestrator.ts`
- Test: `tests/shared/postId.test.ts`, `tests/desktop/orchestrator.test.ts`

**Interfaces:**
- Produces:
  - `laterPostId(current: string | null, candidate: string): string`
  - `SessionOutcome`의 `opened: true` 분기에 `lastProcessedPostId: string | null` 추가

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/shared/postId.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { laterPostId } from '../../src/shared/postId.js'

describe('laterPostId', () => {
  it('takes the candidate when nothing is recorded yet', () => {
    expect(laterPostId(null, '1001')).toBe('1001')
  })

  it('compares numerically, not lexicographically', () => {
    // '9' > '10' as strings, which would stall the watermark forever.
    expect(laterPostId('9', '10')).toBe('10')
    expect(laterPostId('10', '9')).toBe('10')
  })

  it('keeps the current value when the candidate is older', () => {
    expect(laterPostId('1005', '1001')).toBe('1005')
  })

  it('handles ids beyond the safe integer range', () => {
    expect(laterPostId('9007199254740993', '9007199254740992')).toBe('9007199254740993')
  })

  it('falls back to lexicographic order for non-numeric ids', () => {
    expect(laterPostId('abc', 'abd')).toBe('abd')
  })
})
```

`tests/desktop/orchestrator.test.ts`에 추가:

```ts
describe('runSession — watermark', () => {
  it('reports the furthest post it finished handling', async () => {
    const transport = fakeTransport({ candidates: [candidate('8001'), candidate('8003'), candidate('8002')] })
    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, lastProcessedPostId: '8003' })
  })

  it('reports null when nothing was collected', async () => {
    expect(await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))).toMatchObject({
      opened: true,
      lastProcessedPostId: null,
    })
  })

  it('does not advance past the candidate that hit the session cap', async () => {
    const many = [candidate('9001'), candidate('9002'), candidate('9003')]
    const limits = { ...PROFILES.production, perSessionCap: 1 }
    const transport = fakeTransport({ candidates: many })

    // 9001 executes, 9002 is claimed then parked by the cap, 9003 is untouched.
    expect(await runSession(deps({ transport, limits }))).toMatchObject({ lastProcessedPostId: '9002' })
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

- [ ] **Step 3: 구현**

`src/shared/postId.ts`:

```ts
const NUMERIC = /^\d+$/

/**
 * Naver post ids are ascending decimal integers, but they outgrow Number's safe
 * range, so comparison goes through BigInt. Non-numeric ids fall back to
 * lexicographic order rather than throwing — a stalled watermark is a bug we
 * want visible in tests, not a crash in production.
 */
export function laterPostId(current: string | null, candidate: string): string {
  if (current === null) return candidate
  if (NUMERIC.test(current) && NUMERIC.test(candidate)) {
    return BigInt(candidate) > BigInt(current) ? candidate : current
  }
  return candidate > current ? candidate : current
}
```

`src/shared/index.ts`에 `export * from './postId.js'` 추가.

`src/desktop/orchestrator.ts`:

- 상단 import에 `import { laterPostId } from '../shared/postId.js'` 추가
- `SessionOutcome`의 `opened: true` 분기에 `lastProcessedPostId: string | null` 추가
- 카운터 선언부에 `let lastProcessedPostId: string | null = null` 추가
- 루프 안에서 `if (executionId === null) continue` **바로 앞**에 다음을 넣어, 중복이라 건너뛰는 글도 처리한 것으로 친다:

```ts
    lastProcessedPostId = laterPostId(lastProcessedPostId, raw.postId)
```

- 세션 상한으로 `break` 하기 직전의 `deps.repo.applyPatch(...)` 다음 줄에서 워터마크가 이미 그 글까지 전진해 있으므로 추가 조치는 없다
- 마지막 `return`을 다음으로 바꾼다:

```ts
  return { opened: true, executed, skipped, awaitingApproval, failed, expired, lastProcessedPostId }
```

워터마크를 수집 직후가 아니라 **글 하나를 처리할 때마다** 전진시키는 것이 핵심이다. 수집 직후 전진시키면 앱이 중간에 죽었을 때 그 사이 글을 영원히 놓친다.

- [ ] **Step 4: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: report the furthest handled post so the watermark can advance"
```

---

### Task 5: 실행 큐 — 재시도와 승인된 건을 함께 처리

**Files:**
- Modify: `src/desktop/db/executionsRepo.ts` (`listQueued`)
- Modify: `src/desktop/orchestrator.ts`
- Test: `tests/desktop/db/executionsRepo.test.ts`, `tests/desktop/orchestrator.test.ts`

**Interfaces:**
- Produces:
  - `QueuedRow { id; cafeId; boardId; targetPostId; renderedText; templateId; attempts }`
  - `ExecutionsRepo.listQueued(automationId): QueuedRow[]`
  - `runSession`이 신규 수집분보다 **먼저** `QUEUED` 행을 실행한다

지금까지 `runSession`은 이번 세션에 수집한 후보만 실행했다. 그래서 `RETRY_WAIT`에서 되살아난 건과 사람이 승인한 건은 영원히 실행되지 않는다. 이 태스크가 그 구멍을 막는다.

- [ ] **Step 1: 리포지토리 테스트 추가**

`tests/desktop/db/executionsRepo.test.ts`에 추가:

```ts
describe('listQueued', () => {
  it('returns rows ready to execute with the text already decided', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 1_000)

    repo.applyPatch(a, { status: 'QUEUED', renderedText: 'hello', templateId: 'tpl-1', attempts: 1 })
    repo.applyPatch(b, { status: 'AWAITING_APPROVAL' })

    const queued = repo.listQueued(AUTOMATION)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      id: a,
      cafeId: '10000000',
      boardId: '5',
      targetPostId: '1001',
      renderedText: 'hello',
      templateId: 'tpl-1',
      attempts: 1,
    })
  })

  it('omits queued rows that have no text yet', async () => {
    const a = await claim('1003', 1_000)
    repo.applyPatch(a, { status: 'QUEUED' })
    expect(repo.listQueued(AUTOMATION)).toEqual([])
  })
})
```

- [ ] **Step 2: 오케스트레이터 테스트 추가**

`tests/desktop/orchestrator.test.ts`에 추가:

```ts
describe('runSession — queued backlog', () => {
  it('executes a previously queued row before collecting anything new', async () => {
    // First session fails, leaving a RETRY_WAIT row.
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('4100')], executeOk: false }) }))

    const parked = repo.listUnresolved('welcome-comment')[0]
    expect(parked?.status).toBe('RETRY_WAIT')

    // Promote it by hand; Task 6 automates this.
    repo.applyPatch(parked!.id, { status: 'QUEUED' })

    const outcome = await runSession(deps({ transport: fakeTransport({ candidates: [] }) }))
    expect(outcome).toMatchObject({ opened: true, executed: 1 })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('resends the same text rather than re-rendering', async () => {
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('4200')], executeOk: false }) }))
    const parked = repo.listUnresolved('welcome-comment')[0]
    repo.applyPatch(parked!.id, { status: 'QUEUED' })

    await runSession(
      deps({
        transport: fakeTransport({ candidates: [] }),
        // A different renderer would produce different text if it were consulted.
        renderBody: () => ({ templateId: 'tpl-2', body: 'DIFFERENT' }),
      }),
    )

    expect(repo.getById(parked!.id)?.status).toBe('SUCCESS')
    const rows = db.select().from(executions).all()
    expect(rows[0]?.renderedText).toBe('nick님 환영합니다')
  })

  it('counts a queued row against the session cap', async () => {
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('4300')], executeOk: false }) }))
    const parked = repo.listUnresolved('welcome-comment')[0]
    repo.applyPatch(parked!.id, { status: 'QUEUED' })

    const limits = { ...PROFILES.production, perSessionCap: 1 }
    const outcome = await runSession(
      deps({ transport: fakeTransport({ candidates: [candidate('4301')] }), limits }),
    )

    // The backlog row consumed the only slot; the fresh candidate is parked.
    expect(outcome).toMatchObject({ opened: true, executed: 1 })
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm test
```

- [ ] **Step 4: `listQueued` 구현**

`src/desktop/db/executionsRepo.ts`에 타입과 메서드를 추가한다.

```ts
export interface QueuedRow {
  readonly id: string
  readonly cafeId: string
  readonly boardId: string
  readonly targetPostId: string
  readonly renderedText: string
  readonly templateId: string | null
  readonly attempts: number
}
```

`ExecutionsRepo` 인터페이스에 `listQueued(automationId: string): QueuedRow[]` 추가.

구현체에 추가:

```ts
    listQueued(automationId) {
      return db
        .select()
        .from(executions)
        .where(and(eq(executions.automationId, automationId), eq(executions.status, 'QUEUED')))
        .all()
        .flatMap((r) =>
          // A queued row with no text was decided but never rendered; the
          // session that claimed it will render and execute it in the same pass.
          r.renderedText === null
            ? []
            : [
                {
                  id: r.id,
                  cafeId: r.cafeId,
                  boardId: r.boardId,
                  targetPostId: r.targetPostId,
                  renderedText: r.renderedText,
                  templateId: r.templateId,
                  attempts: r.attempts,
                },
              ],
        )
    },
```

- [ ] **Step 5: 오케스트레이터를 작업 큐 기반으로 리팩터**

`src/desktop/orchestrator.ts`에서, 백로그 브레이크 검사 **다음**·수집 **앞**에 다음 헬퍼와 호출을 넣는다.

먼저 파일 하단(`runSession` 위)에 공용 실행 단계를 추출한다:

```ts
interface ExecutionJob {
  readonly executionId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly body: string
  readonly templateId: string | null
  readonly priorAttempts: number
}

type JobResult = 'EXECUTED' | 'SKIPPED' | 'FAILED' | 'RETRY' | 'STOP'

/**
 * Everything from the gate to the recorded outcome, shared by backlog rows and
 * freshly collected candidates so both obey the same caps, pacing and re-check.
 */
async function runJob(
  deps: SessionDeps,
  job: ExecutionJob,
  counters: { dailyCount: number; sessionCount: number },
): Promise<JobResult> {
  const gate = checkGates(
    { killed: deps.isKilled(), dailyCount: counters.dailyCount, sessionCount: counters.sessionCount },
    deps.limits,
  )
  if (!gate.allowed) {
    const now = deps.clock.now()
    if (gate.reason === 'SESSION_CAP_REACHED') {
      deps.repo.applyPatch(job.executionId, { status: 'QUEUED' })
      return 'STOP'
    }
    if (gate.reason === 'KILLED') {
      deps.repo.applyPatch(job.executionId, {
        status: transition('QUEUED', { type: 'KILLED' }, deps.limits),
        reason: 'KILLED',
        resolvedAt: now,
      })
      return 'STOP'
    }
    deps.repo.applyPatch(job.executionId, {
      status: transition('QUEUED', { type: 'DAILY_CAP_EXCEEDED' }, deps.limits),
      reason: 'DAILY_CAP_EXCEEDED',
      resolvedAt: now,
    })
    return 'SKIPPED'
  }

  await deps.sleep(nextActionDelayMs(deps.limits, deps.random))

  const authorsNow = await recheckComments(deps, job)
  if (authorsNow === null) {
    deps.repo.applyPatch(job.executionId, {
      status: 'SKIPPED',
      reason: 'COMMENT_CHECK_FAILED',
      resolvedAt: deps.clock.now(),
    })
    return 'SKIPPED'
  }
  if (authorsNow.some((author) => deps.operatorAccounts.includes(author))) {
    deps.repo.applyPatch(job.executionId, {
      status: 'SKIPPED',
      reason: 'ALREADY_COMMENTED',
      resolvedAt: deps.clock.now(),
    })
    return 'SKIPPED'
  }

  const startedAt = deps.clock.now()
  const result = await execute(deps, job)
  const attempts = job.priorAttempts + 1
  const finishedAt = deps.clock.now()

  if (result !== null && result.ok) {
    deps.repo.applyPatch(job.executionId, {
      status: transition('QUEUED', { type: 'EXECUTION_SUCCEEDED' }, deps.limits),
      strategy: result.strategy,
      templateId: job.templateId,
      renderedText: job.body,
      attempts,
      executedAt: startedAt,
      resolvedAt: finishedAt,
    })
    return 'EXECUTED'
  }

  const nextStatus = transition('QUEUED', { type: 'EXECUTION_FAILED', attempts }, deps.limits)
  deps.repo.applyPatch(job.executionId, {
    status: nextStatus,
    templateId: job.templateId,
    renderedText: job.body,
    attempts,
    reason: result?.error ?? 'NO_REPLY',
    executedAt: startedAt,
    resolvedAt: nextStatus === 'FAILED' ? finishedAt : null,
  })
  return nextStatus === 'FAILED' ? 'FAILED' : 'RETRY'
}
```

`recheckComments`와 `execute`의 시그니처를 `Candidate` 대신 `{ cafeId; boardId; postId }`를 받도록 좁힌다. `execute`는 `body`도 job에서 받는다.

`runSession` 본문은 이렇게 바뀐다 — 백로그를 먼저 돌리고, 그다음 수집분을 돌린다:

```ts
  const backlog = deps.repo.listQueued(deps.automationId)
  for (const row of backlog) {
    const outcome = await runJob(
      deps,
      {
        executionId: row.id,
        cafeId: row.cafeId,
        boardId: row.boardId,
        postId: row.targetPostId,
        body: row.renderedText,
        templateId: row.templateId,
        priorAttempts: row.attempts,
      },
      { dailyCount, sessionCount: executed },
    )
    if (outcome === 'EXECUTED') {
      executed += 1
      dailyCount += 1
    } else if (outcome === 'SKIPPED') {
      skipped += 1
    } else if (outcome === 'FAILED') {
      failed += 1
    } else if (outcome === 'STOP') {
      return { opened: true, executed, skipped, awaitingApproval, failed, expired, lastProcessedPostId }
    }
  }
```

신규 후보 루프에서는 `claim` → guards → 정책 판정 → 렌더링까지 한 뒤 같은 `runJob`을 호출한다. 렌더링 실패(치환 변수 누락)는 `VARIABLE_EXTRACTION_FAILED` 위험 신호로 다루어 정책에 맡긴다.

- [ ] **Step 6: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: execute the queued backlog before newly collected candidates"
```

---

### Task 6: 재시도 승격과 만료 스윕

**Files:**
- Create: `src/desktop/retries.ts`, `src/desktop/approvals.ts`
- Modify: `src/desktop/db/executionsRepo.ts` (`listByStatus`)
- Test: `tests/desktop/retries.test.ts`, `tests/desktop/approvals.test.ts`

**Interfaces:**
- Produces:
  - `ExecutionsRepo.listByStatus(automationId, status): UnresolvedRow[]`
  - `promoteRetries(repo, automationId, limits, nowMs): { promoted: number; expired: number }`
  - `sweepApprovals(repo, automationId, limits, nowMs): { expired: number }`
  - `approve(repo, executionId, limits): void`, `reject(repo, executionId, nowMs): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/desktop/retries.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { promoteRetries } from '../../src/desktop/retries.js'
import { PROFILES } from '../../src/shared/profiles.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const AUTOMATION = 'welcome-comment'
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)
const limits = PROFILES.production

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let counter = 0

async function seed(postId: string, postedAt: number, status: 'RETRY_WAIT' | 'QUEUED'): Promise<string> {
  const store = createSqliteDedupeStore(db, () => `id-${++counter}`)
  const id = await store.claim({
    automationId: AUTOMATION,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: null,
    authorNickname: 'nick',
    authorId: 'm1',
    postedAt,
    detectedAt: postedAt,
  })
  if (id === null) throw new Error('seed claim failed')
  repo.applyPatch(id, { status, renderedText: 'hello', attempts: 1 })
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-retry-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('promoteRetries', () => {
  it('promotes a fresh retry back to the queue', async () => {
    const id = await seed('1001', NOW - 2 * HOUR, 'RETRY_WAIT')

    expect(promoteRetries(repo, AUTOMATION, limits, NOW)).toEqual({ promoted: 1, expired: 0 })
    expect(repo.getById(id)?.status).toBe('QUEUED')
  })

  it('expires a retry whose post has grown stale instead of promoting it', async () => {
    const id = await seed('1002', NOW - 30 * HOUR, 'RETRY_WAIT')

    expect(promoteRetries(repo, AUTOMATION, limits, NOW)).toEqual({ promoted: 0, expired: 1 })
    expect(repo.getById(id)?.status).toBe('EXPIRED')
  })

  it('leaves rows that are already queued alone', async () => {
    const id = await seed('1003', NOW - HOUR, 'QUEUED')

    expect(promoteRetries(repo, AUTOMATION, limits, NOW)).toEqual({ promoted: 0, expired: 0 })
    expect(repo.getById(id)?.status).toBe('QUEUED')
  })
})
```

`tests/desktop/approvals.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { approve, reject, sweepApprovals } from '../../src/desktop/approvals.js'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { PROFILES } from '../../src/shared/profiles.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const AUTOMATION = 'welcome-comment'
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 7, 24, 10, 0, 0)
const limits = PROFILES.production

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let counter = 0

async function seedAwaiting(postId: string, detectedAt: number): Promise<string> {
  const store = createSqliteDedupeStore(db, () => `id-${++counter}`)
  const id = await store.claim({
    automationId: AUTOMATION,
    cafeId: '10000000',
    boardId: '5',
    postId,
    title: null,
    authorNickname: 'nick',
    authorId: 'm1',
    postedAt: detectedAt,
    detectedAt,
  })
  if (id === null) throw new Error('seed claim failed')
  repo.applyPatch(id, { status: 'AWAITING_APPROVAL', renderedText: 'hello' })
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-approval-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('approve', () => {
  it('moves an awaiting row into the queue', async () => {
    const id = await seedAwaiting('1001', NOW - HOUR)
    approve(repo, id, limits)
    expect(repo.getById(id)?.status).toBe('QUEUED')
  })

  it('refuses to approve a row that is not awaiting approval', async () => {
    const id = await seedAwaiting('1002', NOW - HOUR)
    repo.applyPatch(id, { status: 'SUCCESS', resolvedAt: NOW })
    expect(() => approve(repo, id, limits)).toThrow()
  })
})

describe('reject', () => {
  it('terminates the row as skipped with the operator reason', async () => {
    const id = await seedAwaiting('1003', NOW - HOUR)
    reject(repo, id, NOW)

    const row = repo.getById(id)
    expect(row?.status).toBe('SKIPPED')
    expect(row?.reason).toBe('REJECTED_BY_OPERATOR')
    expect(row?.resolvedAt).toBe(NOW)
  })
})

describe('sweepApprovals', () => {
  it('expires rows that waited past the ttl', async () => {
    const stale = await seedAwaiting('1004', NOW - 50 * HOUR)
    const fresh = await seedAwaiting('1005', NOW - 2 * HOUR)

    expect(sweepApprovals(repo, AUTOMATION, limits, NOW)).toEqual({ expired: 1 })
    expect(repo.getById(stale)?.status).toBe('EXPIRED')
    expect(repo.getById(fresh)?.status).toBe('AWAITING_APPROVAL')
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

- [ ] **Step 3: `listByStatus` 추가**

`src/desktop/db/executionsRepo.ts`의 인터페이스에 추가:

```ts
  listByStatus(automationId: string, status: ExecutionStatus): UnresolvedRow[]
```

구현체에 추가 (`listUnresolved` 옆):

```ts
    listByStatus(automationId, status) {
      return db
        .select()
        .from(executions)
        .where(and(eq(executions.automationId, automationId), eq(executions.status, status)))
        .all()
        .map((r) => ({
          id: r.id,
          targetPostId: r.targetPostId,
          targetPostedAt: r.targetPostedAt,
          status: r.status,
          attempts: r.attempts,
        }))
    },
```

`UnresolvedRow`에 `detectedAt: number`를 추가하고 두 매퍼 모두에 `detectedAt: r.detectedAt`를 넣는다. 승인 만료는 감지 시각을 기준으로 재기 때문이다.

- [ ] **Step 4: 구현**

`src/desktop/retries.ts`:

```ts
import { transition } from '../shared/statusMachine.js'
import type { Limits } from '../shared/types.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'

export interface PromoteResult {
  readonly promoted: number
  readonly expired: number
}

/**
 * Runs at the start of each session. A retry whose source post has aged past the
 * backlog limit is dropped rather than promoted — greeting someone days late is
 * worse than not greeting them.
 */
export function promoteRetries(
  repo: ExecutionsRepo,
  automationId: string,
  limits: Limits,
  nowMs: number,
): PromoteResult {
  let promoted = 0
  let expired = 0

  for (const row of repo.listByStatus(automationId, 'RETRY_WAIT')) {
    if (nowMs - row.targetPostedAt > limits.backlogMaxAgeMs) {
      repo.applyPatch(row.id, {
        status: transition('RETRY_WAIT', { type: 'APPROVAL_EXPIRED' }, limits),
        reason: 'STALE_RETRY',
        resolvedAt: nowMs,
      })
      expired += 1
      continue
    }
    repo.applyPatch(row.id, { status: transition('RETRY_WAIT', { type: 'RETRY_DUE' }, limits) })
    promoted += 1
  }

  return { promoted, expired }
}
```

`src/desktop/approvals.ts`:

```ts
import { transition } from '../shared/statusMachine.js'
import type { Limits } from '../shared/types.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'

export function approve(repo: ExecutionsRepo, executionId: string, limits: Limits): void {
  const row = repo.getById(executionId)
  if (row === undefined) throw new Error(`unknown execution ${executionId}`)
  repo.applyPatch(executionId, { status: transition(row.status, { type: 'APPROVED' }, limits) })
}

export function reject(repo: ExecutionsRepo, executionId: string, nowMs: number): void {
  const row = repo.getById(executionId)
  if (row === undefined) throw new Error(`unknown execution ${executionId}`)
  repo.applyPatch(executionId, {
    status: transition(row.status, { type: 'REJECTED' }, { maxAttempts: 0 }),
    reason: 'REJECTED_BY_OPERATOR',
    resolvedAt: nowMs,
  })
}

export interface SweepResult {
  readonly expired: number
}

/**
 * Approval requests go stale. A greeting approved two days after signup reads
 * worse than none, so the queue drops them instead of growing without bound.
 */
export function sweepApprovals(
  repo: ExecutionsRepo,
  automationId: string,
  limits: Limits,
  nowMs: number,
): SweepResult {
  let expired = 0

  for (const row of repo.listByStatus(automationId, 'AWAITING_APPROVAL')) {
    if (nowMs - row.detectedAt <= limits.approvalTtlMs) continue
    repo.applyPatch(row.id, {
      status: transition('AWAITING_APPROVAL', { type: 'APPROVAL_EXPIRED' }, limits),
      reason: 'APPROVAL_TIMEOUT',
      resolvedAt: nowMs,
    })
    expired += 1
  }

  return { expired }
}
```

- [ ] **Step 5: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: add retry promotion and approval expiry sweep"
```

---

### Task 7: 세션 루프와 런타임

**Files:**
- Create: `src/desktop/runtime.ts`, `src/desktop/sessionLoop.ts`
- Test: `tests/desktop/runtime.test.ts`, `tests/desktop/sessionLoop.test.ts`

**Interfaces:**
- Produces:
  - `systemClock: Clock`, `systemRandom: Random`
  - `SessionLoop { start(): void; stop(): void; isRunning(): boolean; runOnce(): Promise<void> }`
  - `createSessionLoop(deps: SessionLoopDeps): SessionLoop`

- [ ] **Step 1: 런타임 테스트 작성**

`tests/desktop/runtime.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { systemClock, systemRandom } from '../../src/desktop/runtime.js'

describe('systemClock', () => {
  it('reports a plausible current time', () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(1_000)
  })

  it('decomposes a timestamp into local parts', () => {
    const at = new Date(2026, 7, 24, 13, 45, 0).getTime()
    expect(systemClock.parts(at)).toEqual({ hour: 13, minute: 45, dayOfWeek: 1 })
  })

  it('anchors to a local hour on the same day', () => {
    const at = new Date(2026, 7, 24, 13, 45, 30, 500).getTime()
    expect(systemClock.atHour(at, 8)).toBe(new Date(2026, 7, 24, 8, 0, 0, 0).getTime())
  })

  it('adds days on the calendar, keeping the wall-clock time', () => {
    const at = new Date(2026, 7, 31, 12, 0, 0).getTime()
    expect(systemClock.parts(systemClock.addDays(at, 1)).hour).toBe(12)
  })
})

describe('systemRandom', () => {
  it('stays inside the requested range', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = systemRandom.intInclusive(8, 25)
      expect(value).toBeGreaterThanOrEqual(8)
      expect(value).toBeLessThanOrEqual(25)
    }
  })

  it('can return both bounds', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 500; i += 1) seen.add(systemRandom.intInclusive(0, 1))
    expect(seen).toEqual(new Set([0, 1]))
  })
})
```

- [ ] **Step 2: 런타임 구현**

`src/desktop/runtime.ts`:

```ts
import { randomInt } from 'node:crypto'
import type { Clock, Random } from '../shared/ports.js'

/** Local-time clock. The operating window is expressed in the operator's day. */
export const systemClock: Clock = {
  now() {
    return Date.now()
  },
  parts(epochMs) {
    const d = new Date(epochMs)
    return { hour: d.getHours(), minute: d.getMinutes(), dayOfWeek: d.getDay() }
  },
  atHour(epochMs, hour) {
    const d = new Date(epochMs)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0).getTime()
  },
  addDays(epochMs, days) {
    const d = new Date(epochMs)
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + days,
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ).getTime()
  },
}

export const systemRandom: Random = {
  intInclusive(min, max) {
    // randomInt's upper bound is exclusive.
    return randomInt(min, max + 1)
  },
}
```

`addDays`가 단순 밀리초 덧셈이 아닌 것에 유의한다. 달력 기준으로 더해야 서머타임이 있는 지역에서도 벽시계 시각이 유지된다.

- [ ] **Step 3: 세션 루프 테스트 작성**

`tests/desktop/sessionLoop.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { SessionOutcome } from '../../src/desktop/orchestrator.js'
import { createSessionLoop, type SessionLoopDeps } from '../../src/desktop/sessionLoop.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

const idleOutcome: SessionOutcome = {
  opened: true,
  executed: 0,
  skipped: 0,
  awaitingApproval: 0,
  failed: 0,
  expired: 0,
  lastProcessedPostId: null,
}

function loopDeps(overrides: Partial<SessionLoopDeps> = {}): SessionLoopDeps {
  return {
    limits: PROFILES.production,
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([50 * 60_000]),
    runSession: () => Promise.resolve(idleOutcome),
    onOutcome: () => {},
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
    ...overrides,
  }
}

describe('createSessionLoop', () => {
  it('is not running before start', () => {
    expect(createSessionLoop(loopDeps()).isRunning()).toBe(false)
  })

  it('reports running after start and stopped after stop', () => {
    const loop = createSessionLoop(loopDeps({ setTimer: () => 1 }))
    loop.start()
    expect(loop.isRunning()).toBe(true)
    loop.stop()
    expect(loop.isRunning()).toBe(false)
  })

  it('schedules the next session using the jittered interval', () => {
    // Typed params so the assertion can read the delay argument.
    const setTimer = vi.fn((_fn: () => void, _ms: number) => 1)
    const loop = createSessionLoop(loopDeps({ setTimer }))

    loop.start()

    expect(setTimer).toHaveBeenCalledTimes(1)
    expect(setTimer.mock.calls[0]?.[1]).toBe(50 * 60_000)
    loop.stop()
  })

  it('cancels the pending timer on stop', () => {
    const clearTimer = vi.fn()
    const loop = createSessionLoop(loopDeps({ setTimer: () => 42, clearTimer }))

    loop.start()
    loop.stop()

    expect(clearTimer).toHaveBeenCalledWith(42)
  })

  it('is idempotent on repeated start', () => {
    const setTimer = vi.fn(() => 1)
    const loop = createSessionLoop(loopDeps({ setTimer }))

    loop.start()
    loop.start()

    expect(setTimer).toHaveBeenCalledTimes(1)
    loop.stop()
  })

  it('runs a session immediately on runOnce and reports the outcome', async () => {
    const outcomes: SessionOutcome[] = []
    const loop = createSessionLoop(loopDeps({ onOutcome: (o) => outcomes.push(o) }))

    await loop.runOnce()

    expect(outcomes).toEqual([idleOutcome])
  })

  it('keeps the loop usable when a session throws', async () => {
    const errors: unknown[] = []
    const loop = createSessionLoop(
      loopDeps({
        setTimer: () => 1,
        runSession: () => Promise.reject(new Error('boom')),
        onError: (e) => errors.push(e),
      }),
    )

    await loop.runOnce()

    expect(errors).toHaveLength(1)
    // A thrown session must not leave the loop dead.
    loop.start()
    expect(loop.isRunning()).toBe(true)
    loop.stop()
  })
})
```

- [ ] **Step 4: 테스트 실행해 실패 확인**

```bash
pnpm test
```

- [ ] **Step 5: 세션 루프 구현**

`src/desktop/sessionLoop.ts`:

```ts
import type { Clock, Random } from '../shared/ports.js'
import { nextSessionStart } from '../shared/schedule.js'
import type { Limits } from '../shared/types.js'
import type { SessionOutcome } from './orchestrator.js'

export type TimerHandle = number

export interface SessionLoopDeps {
  readonly limits: Limits
  readonly clock: Clock
  readonly random: Random
  readonly runSession: () => Promise<SessionOutcome>
  readonly onOutcome: (outcome: SessionOutcome) => void
  readonly onError?: (error: unknown) => void
  readonly setTimer: (fn: () => void, ms: number) => TimerHandle
  readonly clearTimer: (handle: TimerHandle) => void
}

export interface SessionLoop {
  start(): void
  stop(): void
  isRunning(): boolean
  runOnce(): Promise<void>
}

/**
 * Owns the cadence. The extension has no business timer, so everything about
 * when work happens lives here and a torn-down service worker loses nothing.
 */
export function createSessionLoop(deps: SessionLoopDeps): SessionLoop {
  let timer: TimerHandle | null = null
  let running = false

  async function runOnce(): Promise<void> {
    try {
      deps.onOutcome(await deps.runSession())
    } catch (error) {
      deps.onError?.(error)
    }
  }

  function schedule(): void {
    const now = deps.clock.now()
    const at = nextSessionStart(now, deps.limits, deps.clock, deps.random)
    timer = deps.setTimer(() => {
      void runOnce().finally(() => {
        if (running) schedule()
      })
    }, Math.max(0, at - now))
  }

  return {
    start() {
      if (running) return
      running = true
      schedule()
    },

    stop() {
      running = false
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
    },

    isRunning() {
      return running
    },

    runOnce,
  }
}
```

`setTimer`·`clearTimer`를 주입받는 이유는 테스트에서 실제 45분을 기다리지 않기 위해서다. `Clock`·`Random`과 같은 이유의 포트다.

- [ ] **Step 6: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A
git commit -m "feat: add system clock, random and the session loop"
```

---

### Task 8: 앱 조립과 Electron 셸

**Files:**
- Create: `src/desktop/bootstrap.ts`, `src/desktop/ipc.ts`, `src/desktop/preload.ts`, `src/desktop/main.ts`
- Modify: `package.json` (Electron 의존성, `main` 필드, `start` 스크립트)
- Test: `tests/desktop/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 3의 저장소 4종, Task 7의 `systemClock`·`systemRandom`·`createSessionLoop`, Phase 2의 `createBridgeServer`·`generateToken`
- Produces:
  - `WELCOME_AUTOMATION_ID`
  - `AppContext { db; settings; repos; bridge; loop; shutdown() }`
  - `createAppContext(options): Promise<AppContext>`
  - `IPC_CHANNELS`, `DashboardSnapshot`, `AwaitingItem`, `RendererApi`

- [ ] **Step 1: Electron 설치와 패키지 설정**

```bash
pnpm add -D electron
```

`package.json`에 `"main": "dist/desktop/main.js"`를 추가하고, `scripts`에 추가:

```json
"start": "pnpm build && electron ."
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/desktop/bootstrap.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppContext, WELCOME_AUTOMATION_ID, type AppContext } from '../../src/desktop/bootstrap.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

let dir: string
let ctx: AppContext

function options(path: string) {
  return { databasePath: path, migrationsFolder: MIGRATIONS, profile: 'debug' as const, bridgePort: 0 }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wm-boot-'))
  ctx = await createAppContext(options(join(dir, 'app.db')))
})

afterEach(async () => {
  await ctx.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe('createAppContext', () => {
  it('generates a pairing token on first run and reuses it afterwards', async () => {
    const first = ctx.settings.get('pairingToken')
    expect(first).toBeDefined()
    expect(first?.length).toBeGreaterThanOrEqual(32)

    await ctx.shutdown()
    const again = await createAppContext(options(join(dir, 'app.db')))
    expect(again.settings.get('pairingToken')).toBe(first)
    await again.shutdown()
  })

  it('seeds the welcome automation disabled so nothing posts before review', () => {
    expect(ctx.repos.automationSettings.get(WELCOME_AUTOMATION_ID)).toMatchObject({
      policy: 'AUTO',
      enabled: false,
    })
  })

  it('does not start the loop on its own', () => {
    expect(ctx.loop.isRunning()).toBe(false)
  })

  it('listens on a bridge port', () => {
    expect(ctx.bridge.port).toBeGreaterThan(0)
  })

  it('exposes repositories wired to the same database', async () => {
    const id = await ctx.repos.dedupe.claim({
      automationId: WELCOME_AUTOMATION_ID,
      cafeId: '10000000',
      boardId: '5',
      postId: '1001',
      title: null,
      authorNickname: 'nick',
      authorId: 'm1',
      postedAt: 1,
      detectedAt: 1,
    })
    expect(id).not.toBeNull()
    expect(ctx.repos.executions.getById(id!)?.targetPostId).toBe('1001')
  })
})
```

기본값이 `enabled: false`인 것이 중요하다. 설치 직후 아무 설정도 확인하지 않은 상태에서 실제 카페에 댓글이 나가는 것이, 이 설계 전체가 막으려는 사고다.

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import ".../bootstrap.js"`

- [ ] **Step 4: 조립 구현**

`src/desktop/bootstrap.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { PROFILES } from '../shared/profiles.js'
import type { Profile } from '../shared/types.js'
import { createAutomationSettingsRepo, type AutomationSettingsRepo } from './db/automationSettingsRepo.js'
import { openDatabase, type AppDatabase } from './db/client.js'
import { createSqliteDedupeStore, type DedupeStore } from './db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from './db/executionsRepo.js'
import { createSettingsRepo, type SettingsRepo } from './db/settingsRepo.js'
import { createTemplatesRepo, type TemplatesRepo } from './db/templatesRepo.js'
import { createWatermarksRepo, type WatermarksRepo } from './db/watermarksRepo.js'
import { systemClock, systemRandom } from './runtime.js'
import { createSessionLoop, type SessionLoop } from './sessionLoop.js'
import { generateToken } from './ws/pairing.js'
import { createBridgeServer, type BridgeServer } from './ws/server.js'

export const WELCOME_AUTOMATION_ID = 'welcome-comment'

export interface AppContextOptions {
  readonly databasePath: string
  readonly migrationsFolder: string
  readonly profile: Profile
  readonly bridgePort: number
}

export interface AppRepos {
  readonly executions: ExecutionsRepo
  readonly templates: TemplatesRepo
  readonly automationSettings: AutomationSettingsRepo
  readonly watermarks: WatermarksRepo
  readonly dedupe: DedupeStore
}

export interface AppContext {
  readonly db: AppDatabase
  readonly settings: SettingsRepo
  readonly repos: AppRepos
  readonly bridge: BridgeServer
  readonly loop: SessionLoop
  shutdown(): Promise<void>
}

export async function createAppContext(options: AppContextOptions): Promise<AppContext> {
  const db = openDatabase(options.databasePath, { migrationsFolder: options.migrationsFolder })
  const settings = createSettingsRepo(db)

  let token = settings.get('pairingToken')
  if (token === undefined) {
    token = generateToken()
    settings.set('pairingToken', token)
  }

  const automationSettings = createAutomationSettingsRepo(db)
  if (automationSettings.get(WELCOME_AUTOMATION_ID) === undefined) {
    // Disabled by default. An install that starts posting before anyone has
    // reviewed the settings is the accident this design exists to prevent.
    automationSettings.upsert({
      automationId: WELCOME_AUTOMATION_ID,
      policy: 'AUTO',
      limits: {},
      enabled: false,
    })
  }

  const bridge = await createBridgeServer({
    token,
    boundExtensionId: settings.get('boundExtensionId') ?? null,
    port: options.bridgePort,
    onBind: (extensionId) => settings.set('boundExtensionId', extensionId),
  })

  const repos: AppRepos = {
    executions: createExecutionsRepo(db),
    templates: createTemplatesRepo(db),
    automationSettings,
    watermarks: createWatermarksRepo(db),
    dedupe: createSqliteDedupeStore(db, () => randomUUID()),
  }

  const loop = createSessionLoop({
    limits: PROFILES[options.profile],
    clock: systemClock,
    random: systemRandom,
    // Plan C2 replaces this with the assembled session once settings and
    // templates feed into it. The loop's shape is fixed here.
    runSession: () => Promise.reject(new Error('session wiring lands in plan C2')),
    onOutcome: () => {},
    onError: (error) => console.error('[session]', error),
    setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
  })

  return {
    db,
    settings,
    repos,
    bridge,
    loop,
    async shutdown() {
      loop.stop()
      await bridge.close()
    },
  }
}
```

- [ ] **Step 5: IPC 계약 정의**

`src/desktop/ipc.ts`:

```ts
import type { ApprovalPolicy, RiskFlag, Template } from '../shared/types.js'

export const IPC_CHANNELS = {
  getDashboard: 'wm:getDashboard',
  listAwaiting: 'wm:listAwaiting',
  approve: 'wm:approve',
  reject: 'wm:reject',
  listTemplates: 'wm:listTemplates',
  addTemplate: 'wm:addTemplate',
  removeTemplate: 'wm:removeTemplate',
  getSettings: 'wm:getSettings',
  setPolicy: 'wm:setPolicy',
  setEnabled: 'wm:setEnabled',
  getPairingToken: 'wm:getPairingToken',
  killSwitch: 'wm:killSwitch',
} as const

export interface DashboardSnapshot {
  readonly bridgeConnected: boolean
  readonly loopRunning: boolean
  readonly awaitingApproval: number
  readonly executedToday: number
  readonly failedToday: number
}

export interface AwaitingItem {
  readonly id: string
  readonly postId: string
  readonly author: string | null
  readonly title: string | null
  readonly renderedText: string | null
  readonly riskFlags: RiskFlag[]
  readonly detectedAt: number
}

export interface AutomationView {
  readonly policy: ApprovalPolicy
  readonly enabled: boolean
}

export interface RendererApi {
  getDashboard(): Promise<DashboardSnapshot>
  listAwaiting(): Promise<AwaitingItem[]>
  approve(id: string): Promise<void>
  reject(id: string): Promise<void>
  listTemplates(): Promise<Template[]>
  addTemplate(body: string): Promise<void>
  removeTemplate(id: string): Promise<void>
  getSettings(): Promise<AutomationView>
  setPolicy(policy: ApprovalPolicy): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
  getPairingToken(): Promise<string>
  killSwitch(): Promise<void>
}
```

C2가 이 계약을 양쪽에서 구현한다 — 메인의 핸들러와 렌더러의 클라이언트.

- [ ] **Step 6: preload와 Electron 엔트리 작성**

`src/desktop/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from './ipc.js'

const api = Object.fromEntries(
  Object.entries(IPC_CHANNELS).map(([name, channel]) => [
    name,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
)

contextBridge.exposeInMainWorld('wm', api)
```

`src/desktop/main.ts`:

```ts
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { createAppContext, type AppContext } from './bootstrap.js'

const BRIDGE_PORT = 39_217

let context: AppContext | null = null
let tray: Tray | null = null
let window: BrowserWindow | null = null

function showWindow(): void {
  if (window === null) {
    window = new BrowserWindow({
      width: 1_100,
      height: 760,
      show: false,
      webPreferences: {
        preload: fileURLToPath(new URL('preload.js', import.meta.url)),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    window.on('closed', () => {
      window = null
    })
    // The renderer bundle lands in plan C2; an empty window is expected until then.
    void window.loadFile(join(app.getAppPath(), 'dist/renderer/index.html')).catch(() => {})
  }
  window.show()
}

function refreshTray(ctx: AppContext): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: '창 열기', click: showWindow },
      { type: 'separator' },
      {
        label: ctx.loop.isRunning() ? '자동화 중지' : '자동화 시작',
        click: () => {
          if (ctx.loop.isRunning()) ctx.loop.stop()
          else ctx.loop.start()
          refreshTray(ctx)
        },
      },
      {
        label: '전면 정지 (킬 스위치)',
        click: () => {
          ctx.loop.stop()
          refreshTray(ctx)
        },
      },
      { type: 'separator' },
      { label: '종료', role: 'quit' },
    ]),
  )
}

void app.whenReady().then(async () => {
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })

  context = await createAppContext({
    databasePath: join(app.getPath('userData'), 'whisky-manager.db'),
    migrationsFolder: join(app.getAppPath(), 'drizzle'),
    profile: app.isPackaged ? 'production' : 'debug',
    bridgePort: BRIDGE_PORT,
  })

  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Whisky Manager')
  refreshTray(context)
})

// Tray-resident: closing the window must not quit the app.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  void context?.shutdown()
})
```

트레이 아이콘은 빈 이미지로 둔다. 실제 아이콘은 C2에서 디자인과 함께 넣는다. 사용자 노출 문자열은 지금 하드코딩이며, C2에서 i18next로 옮긴다.

- [ ] **Step 7: 통과 확인 후 커밋**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

```bash
git add -A
git commit -m "feat: assemble app context, ipc contract and the electron shell"
```

---

## 이 계획이 끝나면 확보되는 것

- 실행 직전 중복 재확인 — 스펙 5.8절의 마지막 미구현 요구
- 워터마크·재시도·승인·만료가 전부 영속화되고, 앱이 죽었다 살아나도 이어진다
- 스스로 반복 구동되는 세션 루프. 트레이에서 시작·정지·전면 정지
- 렌더러가 붙을 IPC 계약

## 이 계획이 다루지 않는 것

- **렌더러 UI** — 계획 C2. 대시보드형, 색 3개 이내, 라이트·다크 양쪽
- ~~**`runSession` 실제 배선**~~ — 코드 리뷰에서 "항상 실패하는 루프를 남기는 것"이 실질적 결함으로 지적되어 C1에 포함했다. `src/desktop/session.ts`가 매 세션마다 설정·템플릿·워터마크를 새로 읽어 조립하므로, 정책이나 문구를 바꾸면 재시작 없이 다음 세션부터 적용된다
- **긴급 회수** — 실제 삭제는 확장의 엔드포인트가 필요하므로 Phase 3 의존. UI와 앱 쪽 흐름은 C2에서
- **네이버 실제 수집·실행** — Phase 3
