# 네이버 카페 자동화 — 기반 구현 계획 (Phase 0~2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모노레포와 순수 정책 엔진, 앱↔확장 프로토콜·페어링, SQLite 상태 저장을 구축해 확장 스텁이 보낸 후보가 정책 판정을 거쳐 DB에 기록되고 실행 지시로 돌아오는 왕복을 완성한다.

**Architecture:** 판단·스케줄은 전부 Electron 앱(Node)에, 수집·실행은 확장에 둔다. 앱의 판단 로직은 `packages/core`에 순수 함수로 격리하고 시계·난수를 포트로 주입해 브라우저·DB·네이버 없이 전부 단위 테스트한다. 앱과 확장은 `packages/protocol`의 판별 유니온 메시지로만 통신한다.

**Tech Stack:** pnpm workspace, TypeScript 5, Vitest, Electron, better-sqlite3, Drizzle ORM, `ws`, Vite (확장 번들)

**설계 근거:** `docs/superpowers/specs/2026-08-22-naver-cafe-automation-design.md`

## Global Constraints

- **확장 매니페스트에 `cookies` 권한을 넣지 않는다.** 세션 쿠키를 브라우저 밖으로 반출하지 않는다는 원칙의 코드 수준 강제다 (스펙 4.4절)
- `packages/core`는 Electron·브라우저·DB 어디에도 의존하지 않는다
- `packages/automations`는 앱과 확장 양쪽이 임포트하므로 Node 전용 모듈(`better-sqlite3` 등)과 브라우저 전용 API를 모두 배제한다
- `production` 프로파일 값: 세션 주기 45~75분, 세션 내 간격 8~25초, 세션당 상한 15건, 일일 상한 200건, 운영 시간대 08:00~24:00, 주말 세션 주기 배율 1.5
- `debug` 프로파일 값: 세션 주기 2~4분, 세션 내 간격 3~8초, 세션당 상한 5건
- 타임아웃: 로그인 확인 10초, 목록 수집 15초, 댓글 실행 15초, 확장 응답 전반 20초. **무한 대기는 어디에도 없다**
- 재시도 최대 3회. 승인 큐 만료 48시간. 백로그 브레이크 24시간
- 커밋 메시지에 AI 서명·공동저자·이모지를 넣지 않는다
- 코드와 주석은 영어, 커밋 메시지는 conventional commits

## 확장 번들러 결정

스펙 8절은 WXT를 후보로 두되 "착수 시점에 상태를 재확인하고 미심쩍으면 Vite + 수동 manifest로 대체"를 허용했다. **이 계획은 Vite + 수동 manifest를 택한다.**

Phase 0~2에서 확장은 백그라운드 서비스 워커 하나뿐이고 UI가 없다. WXT의 주된 가치인 content script·popup HMR이 적용되지 않는 구간이므로 프레임워크 위험을 감수할 이유가 없다. 옵션 페이지가 등장하는 Phase 4에서 재검토한다.

## File Structure

```
pnpm-workspace.yaml
package.json                          루트 스크립트, devDependencies
tsconfig.base.json                    공통 컴파일러 옵션
eslint.config.js

packages/core/                        순수 TS. 의존성 없음
  src/types.ts                        도메인 타입, 상태 enum, Limits
  src/ports.ts                        Clock / Random 포트 인터페이스
  src/schedule.ts                     세션 주기·지터·운영 시간대·주말 배율
  src/limits.ts                       총량 게이트, 백로그 브레이크
  src/guards.ts                       Guard 타입, 평가기
  src/policy.ts                       승인 정책 → 처분 결정
  src/statusMachine.ts                상태 전이
  src/profiles.ts                     production / debug 프로파일 값
  src/index.ts                        배럴

packages/protocol/                    앱↔확장 공유 메시지 타입
  src/messages.ts
  src/index.ts

packages/automations/                 Automation 인터페이스와 레지스트리만. 구현체는 Phase 3
  src/types.ts
  src/registry.ts
  src/index.ts

apps/desktop/
  src/main/db/schema.ts               Drizzle 스키마
  src/main/db/client.ts               DB 연결·마이그레이션
  src/main/db/dedupeStore.ts          DedupeStore 구현
  src/main/db/executionsRepo.ts       executions 읽기/쓰기
  src/main/ws/pairing.ts              토큰 생성·검증, TOFU origin 고정
  src/main/ws/server.ts               WebSocket 서버
  src/main/orchestrator.ts            세션 조립 — core + DB + WS 연결
  src/main/index.ts                   Electron 엔트리, 트레이
  drizzle.config.ts

apps/extension/
  manifest.json                       MV3. cookies 권한 없음
  src/background.ts                   WS 클라이언트 + alarms 재연결 하트비트
  src/stub.ts                         Phase 2 검증용 가짜 후보 생성기
  vite.config.ts
```

---

### Task 1: 모노레포 스캐폴딩과 툴체인

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`, `packages/core/tests/smoke.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `pnpm build`, `pnpm test`, `pnpm lint` 루트 스크립트. `@ncafe/core` 워크스페이스 패키지

- [ ] **Step 1: 워크스페이스 파일 생성**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json`:

```json
{
  "name": "ncafe-automation",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^2.0.0"
  },
  "packageManager": "pnpm@9.12.0"
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

`eslint.config.js`:

```js
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
)
```

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.env
*.db
*.db-journal
```

- [ ] **Step 2: core 패키지 생성**

`packages/core/package.json`:

```json
{
  "name": "@ncafe/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.ts'], thresholds: { lines: 80, functions: 80, branches: 80 } },
  },
})
```

`packages/core/src/index.ts`:

```ts
export const CORE_PACKAGE_NAME = '@ncafe/core'
```

- [ ] **Step 3: 스모크 테스트 작성**

`packages/core/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CORE_PACKAGE_NAME } from '../src/index.js'

describe('core package', () => {
  it('exposes its package name', () => {
    expect(CORE_PACKAGE_NAME).toBe('@ncafe/core')
  })
})
```

- [ ] **Step 4: 설치하고 전체 파이프라인 통과 확인**

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm lint
```

Expected: 세 명령 모두 exit 0. `core` 테스트 1 passed.

- [ ] **Step 5: 커밋**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json eslint.config.js .gitignore packages/core
git commit -m "chore: scaffold pnpm monorepo with typescript and vitest"
```

---

### Task 2: 도메인 타입과 포트

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/ports.ts`, `packages/core/src/profiles.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/profiles.test.ts`

**Interfaces:**
- Consumes: Task 1의 `@ncafe/core` 패키지
- Produces:
  - `ApprovalPolicy`, `ExecutionStatus`, `UNRESOLVED_STATUSES`, `RiskFlag`, `SkipReason`, `GateBlockReason`, `Candidate`, `Limits`, `Profile`
  - `Clock` (`now`, `parts`, `atHour`, `addDays`), `Random` (`intInclusive`)
  - `PROFILES: Record<Profile, Limits>`

- [ ] **Step 1: 타입 정의 작성**

`packages/core/src/types.ts`:

```ts
export type ApprovalPolicy = 'AUTO' | 'SEMI' | 'MANUAL'

export type ExecutionStatus =
  | 'AWAITING_APPROVAL'
  | 'QUEUED'
  | 'RETRY_WAIT'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'EXPIRED'
  | 'CANCELLED'

/** Statuses that still owe work. The backlog brake counts only these. */
export const UNRESOLVED_STATUSES = ['AWAITING_APPROVAL', 'QUEUED', 'RETRY_WAIT'] as const

export type UnresolvedStatus = (typeof UNRESOLVED_STATUSES)[number]

export function isUnresolved(status: ExecutionStatus): status is UnresolvedStatus {
  return (UNRESOLVED_STATUSES as readonly string[]).includes(status)
}

export type RiskFlag =
  | 'VARIABLE_EXTRACTION_FAILED'
  | 'STRUCTURE_CHANGED'
  | 'ENDPOINT_MISMATCH'
  | 'COMMENT_CHECK_FAILED'

export type SkipReason = 'ALREADY_COMMENTED' | 'RISK_FLAGGED' | 'REJECTED_BY_OPERATOR'

export type GateBlockReason = 'KILLED' | 'DAILY_CAP_EXCEEDED' | 'SESSION_CAP_REACHED'

export type ExecutionStrategy = 'FETCH' | 'DOM'

export interface Candidate {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly authorNickname: string | null
  readonly authorId: string | null
  /** Epoch milliseconds when the source post was written. */
  readonly postedAt: number
}

export interface Limits {
  readonly sessionIntervalMinMs: number
  readonly sessionIntervalMaxMs: number
  readonly actionIntervalMinMs: number
  readonly actionIntervalMaxMs: number
  readonly perSessionCap: number
  readonly dailyCap: number
  /** Local hour the operating window opens, inclusive. */
  readonly activeHourStart: number
  /** Local hour the operating window closes, exclusive. 24 means midnight. */
  readonly activeHourEnd: number
  readonly weekendIntervalMultiplier: number
  readonly backlogMaxAgeMs: number
  readonly approvalTtlMs: number
  readonly maxAttempts: number
}

export type Profile = 'production' | 'debug'
```

- [ ] **Step 2: 포트 정의 작성**

`packages/core/src/ports.ts`:

```ts
export interface TimeParts {
  readonly hour: number
  readonly minute: number
  /** 0 = Sunday, 6 = Saturday. */
  readonly dayOfWeek: number
}

/**
 * All time reading goes through this port so tests can drive the scheduler
 * with a fake calendar instead of waiting for real clocks.
 */
export interface Clock {
  now(): number
  parts(epochMs: number): TimeParts
  /** Same local day as `epochMs`, at `hour`:00:00.000 local time. */
  atHour(epochMs: number, hour: number): number
  addDays(epochMs: number, days: number): number
}

export interface Random {
  /** Uniform integer in [min, max], both inclusive. */
  intInclusive(min: number, max: number): number
}
```

- [ ] **Step 3: 프로파일 값 작성**

`packages/core/src/profiles.ts`:

```ts
import type { Limits, Profile } from './types.js'

const MINUTE = 60_000
const SECOND = 1_000
const HOUR = 3_600_000

const SHARED = {
  activeHourStart: 8,
  activeHourEnd: 24,
  weekendIntervalMultiplier: 1.5,
  backlogMaxAgeMs: 24 * HOUR,
  approvalTtlMs: 48 * HOUR,
  maxAttempts: 3,
} as const

export const PROFILES: Record<Profile, Limits> = {
  production: {
    ...SHARED,
    sessionIntervalMinMs: 45 * MINUTE,
    sessionIntervalMaxMs: 75 * MINUTE,
    actionIntervalMinMs: 8 * SECOND,
    actionIntervalMaxMs: 25 * SECOND,
    perSessionCap: 15,
    dailyCap: 200,
  },
  debug: {
    ...SHARED,
    sessionIntervalMinMs: 2 * MINUTE,
    sessionIntervalMaxMs: 4 * MINUTE,
    actionIntervalMinMs: 3 * SECOND,
    actionIntervalMaxMs: 8 * SECOND,
    perSessionCap: 5,
    dailyCap: 200,
  },
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`packages/core/tests/profiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROFILES } from '../src/profiles.js'
import { isUnresolved } from '../src/types.js'

describe('profiles', () => {
  it('uses the production session interval from the spec', () => {
    expect(PROFILES.production.sessionIntervalMinMs).toBe(45 * 60_000)
    expect(PROFILES.production.sessionIntervalMaxMs).toBe(75 * 60_000)
  })

  it('uses a shorter debug cadence than production', () => {
    expect(PROFILES.debug.sessionIntervalMaxMs).toBeLessThan(PROFILES.production.sessionIntervalMinMs)
  })

  it('keeps every interval range ordered', () => {
    for (const limits of Object.values(PROFILES)) {
      expect(limits.sessionIntervalMinMs).toBeLessThanOrEqual(limits.sessionIntervalMaxMs)
      expect(limits.actionIntervalMinMs).toBeLessThanOrEqual(limits.actionIntervalMaxMs)
    }
  })
})

describe('isUnresolved', () => {
  it('treats work-owing statuses as unresolved', () => {
    expect(isUnresolved('AWAITING_APPROVAL')).toBe(true)
    expect(isUnresolved('QUEUED')).toBe(true)
    expect(isUnresolved('RETRY_WAIT')).toBe(true)
  })

  it('treats terminal statuses as resolved', () => {
    expect(isUnresolved('SUCCESS')).toBe(false)
    expect(isUnresolved('SKIPPED')).toBe(false)
    expect(isUnresolved('CANCELLED')).toBe(false)
  })
})
```

- [ ] **Step 5: 테스트 실행**

```bash
pnpm --filter @ncafe/core test
```

Expected: 5 passed.

- [ ] **Step 6: 배럴 갱신**

`packages/core/src/index.ts`:

```ts
export * from './types.js'
export * from './ports.js'
export * from './profiles.js'
```

- [ ] **Step 7: 커밋**

```bash
git add packages/core
git commit -m "feat(core): add domain types, clock/random ports, and profile limits"
```

---

### Task 3: 세션 스케줄러

**Files:**
- Create: `packages/core/src/schedule.ts`
- Create: `packages/core/tests/fakes.ts`, `packages/core/tests/schedule.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Clock`, `Random`, `Limits` (Task 2)
- Produces:
  - `isWithinActiveHours(epochMs, limits, clock): boolean`
  - `nextActiveStart(epochMs, limits, clock): number`
  - `nextSessionStart(previousSessionEndMs, limits, clock, random): number`
  - `nextActionDelayMs(limits, random): number`
  - 테스트 픽스처 `FakeClock`, `SequenceRandom` (from `tests/fakes.ts`)

- [ ] **Step 1: 테스트 픽스처 작성**

`packages/core/tests/fakes.ts`:

```ts
import type { Clock, Random, TimeParts } from '../src/ports.js'

const DAY_MS = 86_400_000

/** Fake clock anchored to UTC so tests never depend on the host timezone. */
export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current
  }

  set(epochMs: number): void {
    this.current = epochMs
  }

  parts(epochMs: number): TimeParts {
    const d = new Date(epochMs)
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfWeek: d.getUTCDay() }
  }

  atHour(epochMs: number, hour: number): number {
    const d = new Date(epochMs)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0)
  }

  addDays(epochMs: number, days: number): number {
    return epochMs + days * DAY_MS
  }
}

/** Returns the supplied values in order, then repeats the last one. */
export class SequenceRandom implements Random {
  private index = 0

  constructor(private readonly values: number[]) {}

  intInclusive(min: number, max: number): number {
    const raw = this.values[Math.min(this.index, this.values.length - 1)] ?? min
    this.index += 1
    return Math.min(Math.max(raw, min), max)
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/core/tests/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROFILES } from '../src/profiles.js'
import { isWithinActiveHours, nextActionDelayMs, nextActiveStart, nextSessionStart } from '../src/schedule.js'
import { FakeClock, SequenceRandom } from './fakes.js'

const limits = PROFILES.production
// 2026-08-24 is a Monday.
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)
const MON_23_30 = Date.UTC(2026, 7, 24, 23, 30, 0)
const MON_03_00 = Date.UTC(2026, 7, 24, 3, 0, 0)
const SAT_10_00 = Date.UTC(2026, 7, 29, 10, 0, 0)

describe('isWithinActiveHours', () => {
  it('accepts a time inside the operating window', () => {
    expect(isWithinActiveHours(MON_10_00, limits, new FakeClock(MON_10_00))).toBe(true)
  })

  it('rejects a time before the window opens', () => {
    expect(isWithinActiveHours(MON_03_00, limits, new FakeClock(MON_03_00))).toBe(false)
  })

  it('accepts the exact opening hour', () => {
    const at8 = Date.UTC(2026, 7, 24, 8, 0, 0)
    expect(isWithinActiveHours(at8, limits, new FakeClock(at8))).toBe(true)
  })
})

describe('nextActiveStart', () => {
  it('returns today 08:00 when the window has not opened yet', () => {
    const clock = new FakeClock(MON_03_00)
    expect(nextActiveStart(MON_03_00, limits, clock)).toBe(Date.UTC(2026, 7, 24, 8, 0, 0))
  })

  it('returns tomorrow 08:00 when the window has already closed', () => {
    const clock = new FakeClock(MON_23_30)
    const after = Date.UTC(2026, 7, 25, 1, 0, 0)
    expect(nextActiveStart(after, limits, clock)).toBe(Date.UTC(2026, 7, 25, 8, 0, 0))
  })
})

describe('nextSessionStart', () => {
  it('adds a jittered interval inside the configured range', () => {
    const clock = new FakeClock(MON_10_00)
    const random = new SequenceRandom([50 * 60_000])
    expect(nextSessionStart(MON_10_00, limits, clock, random)).toBe(MON_10_00 + 50 * 60_000)
  })

  it('stretches the interval by the weekend multiplier on Saturday', () => {
    const clock = new FakeClock(SAT_10_00)
    const random = new SequenceRandom([60 * 60_000])
    expect(nextSessionStart(SAT_10_00, limits, clock, random)).toBe(SAT_10_00 + 90 * 60_000)
  })

  it('defers to the next operating window when the interval lands outside it', () => {
    const clock = new FakeClock(MON_23_30)
    const random = new SequenceRandom([60 * 60_000])
    expect(nextSessionStart(MON_23_30, limits, clock, random)).toBe(Date.UTC(2026, 7, 25, 8, 0, 0))
  })
})

describe('nextActionDelayMs', () => {
  it('draws from the action interval range', () => {
    const random = new SequenceRandom([12_000])
    expect(nextActionDelayMs(limits, random)).toBe(12_000)
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: FAIL — `Failed to resolve import "../src/schedule.js"`

- [ ] **Step 4: 스케줄러 구현**

`packages/core/src/schedule.ts`:

```ts
import type { Clock, Random } from './ports.js'
import type { Limits } from './types.js'

const SATURDAY = 6
const SUNDAY = 0

export function isWithinActiveHours(epochMs: number, limits: Limits, clock: Clock): boolean {
  const { hour } = clock.parts(epochMs)
  return hour >= limits.activeHourStart && hour < limits.activeHourEnd
}

/**
 * The next moment the operating window is open. If `epochMs` already sits
 * inside the window this still returns the upcoming boundary, so callers
 * should check `isWithinActiveHours` first when they mean "now".
 */
export function nextActiveStart(epochMs: number, limits: Limits, clock: Clock): number {
  const { hour } = clock.parts(epochMs)
  if (hour < limits.activeHourStart) {
    return clock.atHour(epochMs, limits.activeHourStart)
  }
  return clock.atHour(clock.addDays(epochMs, 1), limits.activeHourStart)
}

function isWeekend(epochMs: number, clock: Clock): boolean {
  const { dayOfWeek } = clock.parts(epochMs)
  return dayOfWeek === SATURDAY || dayOfWeek === SUNDAY
}

export function nextSessionStart(
  previousSessionEndMs: number,
  limits: Limits,
  clock: Clock,
  random: Random,
): number {
  const base = random.intInclusive(limits.sessionIntervalMinMs, limits.sessionIntervalMaxMs)
  const multiplier = isWeekend(previousSessionEndMs, clock) ? limits.weekendIntervalMultiplier : 1
  const candidate = previousSessionEndMs + Math.round(base * multiplier)

  if (isWithinActiveHours(candidate, limits, clock)) {
    return candidate
  }
  return nextActiveStart(candidate, limits, clock)
}

export function nextActionDelayMs(limits: Limits, random: Random): number {
  return random.intInclusive(limits.actionIntervalMinMs, limits.actionIntervalMaxMs)
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 6: 배럴 갱신 후 커밋**

`packages/core/src/index.ts`에 추가:

```ts
export * from './schedule.js'
```

```bash
git add packages/core
git commit -m "feat(core): add session scheduler with jitter, active hours, and weekend pacing"
```

---

### Task 4: 총량 게이트와 백로그 브레이크

**Files:**
- Create: `packages/core/src/limits.ts`
- Create: `packages/core/tests/limits.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Limits`, `GateBlockReason`, `Candidate` (Task 2)
- Produces:
  - `GateContext { killed, dailyCount, sessionCount }`
  - `GateVerdict = { allowed: true } | { allowed: false; reason: GateBlockReason }`
  - `checkGates(ctx: GateContext, limits: Limits): GateVerdict`
  - `hasStaleBacklog(unresolved: readonly { postedAt: number }[], nowMs: number, limits: Limits): boolean`
  - `dailyWindowStart(epochMs, limits, clock): number`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROFILES } from '../src/profiles.js'
import { checkGates, dailyWindowStart, hasStaleBacklog } from '../src/limits.js'
import { FakeClock } from './fakes.js'

const limits = PROFILES.production
const HOUR = 3_600_000

describe('checkGates', () => {
  it('allows a normal candidate', () => {
    expect(checkGates({ killed: false, dailyCount: 10, sessionCount: 2 }, limits)).toEqual({ allowed: true })
  })

  it('blocks everything when the kill switch is engaged', () => {
    expect(checkGates({ killed: true, dailyCount: 0, sessionCount: 0 }, limits)).toEqual({
      allowed: false,
      reason: 'KILLED',
    })
  })

  it('blocks once the daily cap is reached', () => {
    expect(checkGates({ killed: false, dailyCount: 200, sessionCount: 0 }, limits)).toEqual({
      allowed: false,
      reason: 'DAILY_CAP_EXCEEDED',
    })
  })

  it('blocks once the per-session cap is reached', () => {
    expect(checkGates({ killed: false, dailyCount: 0, sessionCount: 15 }, limits)).toEqual({
      allowed: false,
      reason: 'SESSION_CAP_REACHED',
    })
  })

  it('reports the kill switch before any cap', () => {
    expect(checkGates({ killed: true, dailyCount: 999, sessionCount: 999 }, limits)).toEqual({
      allowed: false,
      reason: 'KILLED',
    })
  })
})

describe('hasStaleBacklog', () => {
  const now = Date.UTC(2026, 7, 24, 10, 0, 0)

  it('is false when there is no unresolved work', () => {
    expect(hasStaleBacklog([], now, limits)).toBe(false)
  })

  it('is false when unresolved posts are all recent', () => {
    expect(hasStaleBacklog([{ postedAt: now - 6 * HOUR }], now, limits)).toBe(false)
  })

  it('is true when any unresolved post is older than the age limit', () => {
    expect(hasStaleBacklog([{ postedAt: now - 6 * HOUR }, { postedAt: now - 30 * HOUR }], now, limits)).toBe(true)
  })

  it('does not trip on a large but fresh backlog', () => {
    const fresh = Array.from({ length: 80 }, () => ({ postedAt: now - 2 * HOUR }))
    expect(hasStaleBacklog(fresh, now, limits)).toBe(false)
  })
})

describe('dailyWindowStart', () => {
  it('anchors the day to the operating window start', () => {
    const at = Date.UTC(2026, 7, 24, 10, 0, 0)
    expect(dailyWindowStart(at, limits, new FakeClock(at))).toBe(Date.UTC(2026, 7, 24, 8, 0, 0))
  })

  it('rolls back to the previous day before the window opens', () => {
    const at = Date.UTC(2026, 7, 24, 3, 0, 0)
    expect(dailyWindowStart(at, limits, new FakeClock(at))).toBe(Date.UTC(2026, 7, 23, 8, 0, 0))
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: FAIL — `Failed to resolve import "../src/limits.js"`

- [ ] **Step 3: 게이트 구현**

`packages/core/src/limits.ts`:

```ts
import type { Clock } from './ports.js'
import type { GateBlockReason, Limits } from './types.js'

export interface GateContext {
  readonly killed: boolean
  /** Executions already performed inside the current daily window. */
  readonly dailyCount: number
  /** Executions already performed inside the current session. */
  readonly sessionCount: number
}

export type GateVerdict = { allowed: true } | { allowed: false; reason: GateBlockReason }

export function checkGates(ctx: GateContext, limits: Limits): GateVerdict {
  if (ctx.killed) {
    return { allowed: false, reason: 'KILLED' }
  }
  if (ctx.dailyCount >= limits.dailyCap) {
    return { allowed: false, reason: 'DAILY_CAP_EXCEEDED' }
  }
  if (ctx.sessionCount >= limits.perSessionCap) {
    return { allowed: false, reason: 'SESSION_CAP_REACHED' }
  }
  return { allowed: true }
}

/**
 * The brake watches age, not volume. A large backlog that arrived overnight is
 * normal; a backlog containing days-old posts means something is broken.
 */
export function hasStaleBacklog(
  unresolved: readonly { postedAt: number }[],
  nowMs: number,
  limits: Limits,
): boolean {
  return unresolved.some((item) => nowMs - item.postedAt > limits.backlogMaxAgeMs)
}

/**
 * Daily counting is anchored to the operating window start, not midnight, so a
 * 23:00 execution and an 08:00 execution the next morning fall on different days
 * the way an operator would expect.
 */
export function dailyWindowStart(epochMs: number, limits: Limits, clock: Clock): number {
  const { hour } = clock.parts(epochMs)
  if (hour >= limits.activeHourStart) {
    return clock.atHour(epochMs, limits.activeHourStart)
  }
  return clock.atHour(clock.addDays(epochMs, -1), limits.activeHourStart)
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 배럴 갱신 후 커밋**

`packages/core/src/index.ts`에 추가:

```ts
export * from './limits.js'
```

```bash
git add packages/core
git commit -m "feat(core): add volume gates and age-based backlog brake"
```

---

### Task 5: Guard 평가와 승인 정책

**Files:**
- Create: `packages/core/src/guards.ts`, `packages/core/src/policy.ts`
- Create: `packages/core/tests/guards.test.ts`, `packages/core/tests/policy.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Candidate`, `RiskFlag`, `SkipReason`, `ApprovalPolicy` (Task 2)
- Produces:
  - `GuardOutcome`, `GuardContext`, `Guard`, `GuardEvaluation`
  - `evaluateGuards(guards, candidate, ctx): GuardEvaluation`
  - `operatorAlreadyCommentedGuard: Guard`
  - `Disposition = { kind: 'EXECUTE' } | { kind: 'APPROVE_FIRST' } | { kind: 'SKIP'; reason: SkipReason }`
  - `decide(policy, evaluation): Disposition`

- [ ] **Step 1: guards 실패 테스트 작성**

`packages/core/tests/guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Candidate } from '../src/types.js'
import type { Guard, GuardContext } from '../src/guards.js'
import { evaluateGuards, operatorAlreadyCommentedGuard } from '../src/guards.js'

const candidate: Candidate = {
  automationId: 'cafe-welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  postId: '1001',
  authorNickname: '신입회원',
  authorId: 'member-1',
  postedAt: 1_700_000_000_000,
}

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    nowMs: 1_700_000_100_000,
    operatorAccounts: ['cafe-ops'],
    existingCommentAuthors: [],
    ...overrides,
  }
}

describe('operatorAlreadyCommentedGuard', () => {
  it('passes when no operator has commented', () => {
    expect(operatorAlreadyCommentedGuard(candidate, ctx())).toBeNull()
  })

  it('skips when an operator account already commented', () => {
    const outcome = operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: ['cafe-ops'] }))
    expect(outcome).toEqual({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })
  })

  it('skips when any listed staff account commented, not just the executing one', () => {
    const outcome = operatorAlreadyCommentedGuard(
      candidate,
      ctx({ operatorAccounts: ['cafe-ops', 'staff-personal'], existingCommentAuthors: ['staff-personal'] }),
    )
    expect(outcome).toEqual({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })
  })

  it('ignores comments from ordinary members', () => {
    expect(operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: ['random-member'] }))).toBeNull()
  })

  it('raises a risk flag when the comment check could not be performed', () => {
    const outcome = operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: null }))
    expect(outcome).toEqual({ kind: 'RISK', flag: 'COMMENT_CHECK_FAILED' })
  })
})

describe('evaluateGuards', () => {
  const risky: Guard = () => ({ kind: 'RISK', flag: 'STRUCTURE_CHANGED' })
  const clean: Guard = () => null
  const skipping: Guard = () => ({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })

  it('collects no flags when every guard passes', () => {
    expect(evaluateGuards([clean, clean], candidate, ctx())).toEqual({ skip: null, flags: [] })
  })

  it('collects risk flags from every guard that raises one', () => {
    expect(evaluateGuards([risky, clean, risky], candidate, ctx())).toEqual({
      skip: null,
      flags: ['STRUCTURE_CHANGED', 'STRUCTURE_CHANGED'],
    })
  })

  it('short-circuits on skip and stops evaluating', () => {
    expect(evaluateGuards([skipping, risky], candidate, ctx())).toEqual({
      skip: 'ALREADY_COMMENTED',
      flags: [],
    })
  })
})
```

- [ ] **Step 2: policy 실패 테스트 작성**

`packages/core/tests/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decide } from '../src/policy.js'

const clean = { skip: null, flags: [] } as const
const flagged = { skip: null, flags: ['STRUCTURE_CHANGED'] } as const
const skipped = { skip: 'ALREADY_COMMENTED', flags: [] } as const

describe('decide', () => {
  it('executes a clean candidate under AUTO', () => {
    expect(decide('AUTO', clean)).toEqual({ kind: 'EXECUTE' })
  })

  it('skips a flagged candidate under AUTO instead of calling a human', () => {
    expect(decide('AUTO', flagged)).toEqual({ kind: 'SKIP', reason: 'RISK_FLAGGED' })
  })

  it('executes a clean candidate under SEMI', () => {
    expect(decide('SEMI', clean)).toEqual({ kind: 'EXECUTE' })
  })

  it('routes a flagged candidate to approval under SEMI', () => {
    expect(decide('SEMI', flagged)).toEqual({ kind: 'APPROVE_FIRST' })
  })

  it('routes every candidate to approval under MANUAL', () => {
    expect(decide('MANUAL', clean)).toEqual({ kind: 'APPROVE_FIRST' })
    expect(decide('MANUAL', flagged)).toEqual({ kind: 'APPROVE_FIRST' })
  })

  it('honours a guard skip regardless of policy', () => {
    for (const policy of ['AUTO', 'SEMI', 'MANUAL'] as const) {
      expect(decide(policy, skipped)).toEqual({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })
    }
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: FAIL — `Failed to resolve import "../src/guards.js"`

- [ ] **Step 4: guards 구현**

`packages/core/src/guards.ts`:

```ts
import type { Candidate, RiskFlag, SkipReason } from './types.js'

export type GuardOutcome =
  | { kind: 'RISK'; flag: RiskFlag }
  | { kind: 'SKIP'; reason: SkipReason }
  | null

export interface GuardContext {
  readonly nowMs: number
  /** Every account the cafe staff use, not just the executing one. */
  readonly operatorAccounts: readonly string[]
  /** Authors of comments already on the post. `null` means the check failed. */
  readonly existingCommentAuthors: readonly string[] | null
}

export type Guard = (candidate: Candidate, ctx: GuardContext) => GuardOutcome

export interface GuardEvaluation {
  readonly skip: SkipReason | null
  readonly flags: readonly RiskFlag[]
}

/**
 * A post any staff member already greeted is done, whichever account they used.
 * Checking only the executing account double-comments during parallel operation.
 */
export const operatorAlreadyCommentedGuard: Guard = (_candidate, ctx) => {
  if (ctx.existingCommentAuthors === null) {
    return { kind: 'RISK', flag: 'COMMENT_CHECK_FAILED' }
  }
  const operators = new Set(ctx.operatorAccounts)
  const greeted = ctx.existingCommentAuthors.some((author) => operators.has(author))
  return greeted ? { kind: 'SKIP', reason: 'ALREADY_COMMENTED' } : null
}

export function evaluateGuards(
  guards: readonly Guard[],
  candidate: Candidate,
  ctx: GuardContext,
): GuardEvaluation {
  const flags: RiskFlag[] = []
  for (const guard of guards) {
    const outcome = guard(candidate, ctx)
    if (outcome === null) continue
    if (outcome.kind === 'SKIP') {
      return { skip: outcome.reason, flags: [] }
    }
    flags.push(outcome.flag)
  }
  return { skip: null, flags }
}
```

- [ ] **Step 5: policy 구현**

`packages/core/src/policy.ts`:

```ts
import type { GuardEvaluation } from './guards.js'
import type { ApprovalPolicy, SkipReason } from './types.js'

export type Disposition =
  | { kind: 'EXECUTE' }
  | { kind: 'APPROVE_FIRST' }
  | { kind: 'SKIP'; reason: SkipReason }

/**
 * The three policies differ on one axis only: what to do with a candidate that
 * carries a risk flag. AUTO never calls a human, so it skips rather than queues.
 */
export function decide(policy: ApprovalPolicy, evaluation: GuardEvaluation): Disposition {
  if (evaluation.skip !== null) {
    return { kind: 'SKIP', reason: evaluation.skip }
  }
  if (policy === 'MANUAL') {
    return { kind: 'APPROVE_FIRST' }
  }
  if (evaluation.flags.length === 0) {
    return { kind: 'EXECUTE' }
  }
  return policy === 'AUTO' ? { kind: 'SKIP', reason: 'RISK_FLAGGED' } : { kind: 'APPROVE_FIRST' }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 7: 배럴 갱신 후 커밋**

`packages/core/src/index.ts`에 추가:

```ts
export * from './guards.js'
export * from './policy.js'
```

```bash
git add packages/core
git commit -m "feat(core): add guard evaluation and approval policy resolution"
```

---

### Task 6: 상태 기계

**Files:**
- Create: `packages/core/src/statusMachine.ts`
- Create: `packages/core/tests/statusMachine.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ExecutionStatus`, `Limits` (Task 2), `Disposition` (Task 5)
- Produces:
  - `StatusEvent` 유니온
  - `InvalidTransitionError`
  - `initialStatus(disposition: Disposition): ExecutionStatus`
  - `transition(current: ExecutionStatus, event: StatusEvent, limits: Pick<Limits, 'maxAttempts'>): ExecutionStatus`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/core/tests/statusMachine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InvalidTransitionError, initialStatus, transition } from '../src/statusMachine.js'

const limits = { maxAttempts: 3 }

describe('initialStatus', () => {
  it('queues an executable candidate', () => {
    expect(initialStatus({ kind: 'EXECUTE' })).toBe('QUEUED')
  })

  it('parks a candidate that needs approval', () => {
    expect(initialStatus({ kind: 'APPROVE_FIRST' })).toBe('AWAITING_APPROVAL')
  })

  it('terminates a skipped candidate immediately', () => {
    expect(initialStatus({ kind: 'SKIP', reason: 'ALREADY_COMMENTED' })).toBe('SKIPPED')
  })
})

describe('transition from AWAITING_APPROVAL', () => {
  it('queues on approval', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'APPROVED' }, limits)).toBe('QUEUED')
  })

  it('skips on rejection', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'REJECTED' }, limits)).toBe('SKIPPED')
  })

  it('expires after the approval ttl', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'APPROVAL_EXPIRED' }, limits)).toBe('EXPIRED')
  })

  it('cancels on kill switch', () => {
    expect(transition('AWAITING_APPROVAL', { type: 'KILLED' }, limits)).toBe('CANCELLED')
  })
})

describe('transition from QUEUED', () => {
  it('succeeds', () => {
    expect(transition('QUEUED', { type: 'EXECUTION_SUCCEEDED' }, limits)).toBe('SUCCESS')
  })

  it('waits for retry while attempts remain', () => {
    expect(transition('QUEUED', { type: 'EXECUTION_FAILED', attempts: 1 }, limits)).toBe('RETRY_WAIT')
    expect(transition('QUEUED', { type: 'EXECUTION_FAILED', attempts: 2 }, limits)).toBe('RETRY_WAIT')
  })

  it('fails permanently once attempts are exhausted', () => {
    expect(transition('QUEUED', { type: 'EXECUTION_FAILED', attempts: 3 }, limits)).toBe('FAILED')
  })

  it('expires when the daily cap blocks it', () => {
    expect(transition('QUEUED', { type: 'DAILY_CAP_EXCEEDED' }, limits)).toBe('EXPIRED')
  })
})

describe('transition from RETRY_WAIT', () => {
  it('re-queues on the next session without re-claiming', () => {
    expect(transition('RETRY_WAIT', { type: 'RETRY_DUE' }, limits)).toBe('QUEUED')
  })

  it('expires when it grows stale', () => {
    expect(transition('RETRY_WAIT', { type: 'APPROVAL_EXPIRED' }, limits)).toBe('EXPIRED')
  })
})

describe('terminal statuses', () => {
  it('rejects any transition out of a terminal status', () => {
    for (const terminal of ['SUCCESS', 'FAILED', 'SKIPPED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(() => transition(terminal, { type: 'APPROVED' }, limits)).toThrow(InvalidTransitionError)
    }
  })
})

describe('invalid transitions', () => {
  it('rejects approving something already queued', () => {
    expect(() => transition('QUEUED', { type: 'APPROVED' }, limits)).toThrow(InvalidTransitionError)
  })

  it('rejects executing something awaiting approval', () => {
    expect(() => transition('AWAITING_APPROVAL', { type: 'EXECUTION_SUCCEEDED' }, limits)).toThrow(
      InvalidTransitionError,
    )
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: FAIL — `Failed to resolve import "../src/statusMachine.js"`

- [ ] **Step 3: 상태 기계 구현**

`packages/core/src/statusMachine.ts`:

```ts
import type { Disposition } from './policy.js'
import type { ExecutionStatus, Limits } from './types.js'

export type StatusEvent =
  | { type: 'APPROVED' }
  | { type: 'REJECTED' }
  | { type: 'APPROVAL_EXPIRED' }
  | { type: 'EXECUTION_SUCCEEDED' }
  | { type: 'EXECUTION_FAILED'; attempts: number }
  | { type: 'RETRY_DUE' }
  | { type: 'DAILY_CAP_EXCEEDED' }
  | { type: 'KILLED' }

export class InvalidTransitionError extends Error {
  constructor(current: ExecutionStatus, event: StatusEvent['type']) {
    super(`cannot apply ${event} to ${current}`)
    this.name = 'InvalidTransitionError'
  }
}

export function initialStatus(disposition: Disposition): ExecutionStatus {
  switch (disposition.kind) {
    case 'EXECUTE':
      return 'QUEUED'
    case 'APPROVE_FIRST':
      return 'AWAITING_APPROVAL'
    case 'SKIP':
      return 'SKIPPED'
  }
}

export function transition(
  current: ExecutionStatus,
  event: StatusEvent,
  limits: Pick<Limits, 'maxAttempts'>,
): ExecutionStatus {
  if (event.type === 'KILLED' && (current === 'AWAITING_APPROVAL' || current === 'QUEUED' || current === 'RETRY_WAIT')) {
    return 'CANCELLED'
  }

  switch (current) {
    case 'AWAITING_APPROVAL':
      if (event.type === 'APPROVED') return 'QUEUED'
      if (event.type === 'REJECTED') return 'SKIPPED'
      if (event.type === 'APPROVAL_EXPIRED') return 'EXPIRED'
      break

    case 'QUEUED':
      if (event.type === 'EXECUTION_SUCCEEDED') return 'SUCCESS'
      if (event.type === 'EXECUTION_FAILED') {
        return event.attempts >= limits.maxAttempts ? 'FAILED' : 'RETRY_WAIT'
      }
      if (event.type === 'DAILY_CAP_EXCEEDED') return 'EXPIRED'
      break

    case 'RETRY_WAIT':
      if (event.type === 'RETRY_DUE') return 'QUEUED'
      if (event.type === 'APPROVAL_EXPIRED') return 'EXPIRED'
      break

    default:
      break
  }

  throw new InvalidTransitionError(current, event.type)
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/core test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 배럴 갱신 후 커밋**

`packages/core/src/index.ts`에 추가:

```ts
export * from './statusMachine.js'
```

```bash
git add packages/core
git commit -m "feat(core): add execution status machine with retry and kill transitions"
```

---

### Task 7: 앱↔확장 프로토콜

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`
- Create: `packages/protocol/src/messages.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/tests/messages.test.ts`

**Interfaces:**
- Consumes: 없음 (프로토콜은 core에 의존하지 않는다 — 확장이 core를 임포트하지 않아도 되게 하기 위함)
- Produces:
  - `PROTOCOL_VERSION`, `SourceRef`, `RawCandidate`, `ActionEnvelope`
  - `AppMessage`, `ExtensionMessage`
  - `TIMEOUTS`
  - `isAppMessage(value): value is AppMessage`, `isExtensionMessage(value): value is ExtensionMessage`

- [ ] **Step 1: 패키지 생성**

`packages/protocol/package.json`:

```json
{
  "name": "@ncafe/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`packages/protocol/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/protocol/tests/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, TIMEOUTS, isAppMessage, isExtensionMessage } from '../src/messages.js'

describe('protocol version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true)
    expect(PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})

describe('timeouts', () => {
  it('keeps every fetch-bearing timeout under the MV3 service worker limit', () => {
    // A service worker is torn down when a fetch takes longer than 30s, so we cut first.
    expect(TIMEOUTS.collectMs).toBeLessThan(30_000)
    expect(TIMEOUTS.executeMs).toBeLessThan(30_000)
    expect(TIMEOUTS.loginCheckMs).toBeLessThan(30_000)
  })

  it('matches the values fixed in the design spec', () => {
    expect(TIMEOUTS.loginCheckMs).toBe(10_000)
    expect(TIMEOUTS.collectMs).toBe(15_000)
    expect(TIMEOUTS.executeMs).toBe(15_000)
    expect(TIMEOUTS.extensionReplyMs).toBe(20_000)
  })
})

describe('isAppMessage', () => {
  it('accepts a well-formed EXECUTE message', () => {
    expect(
      isAppMessage({
        type: 'EXECUTE',
        requestId: 'r1',
        automationId: 'cafe-welcome-comment',
        action: { cafeId: '10000000', boardId: '5', postId: '1001', body: 'hello' },
      }),
    ).toBe(true)
  })

  it('rejects an unknown type', () => {
    expect(isAppMessage({ type: 'NOPE', requestId: 'r1' })).toBe(false)
  })

  it('rejects a non-object', () => {
    expect(isAppMessage('EXECUTE')).toBe(false)
    expect(isAppMessage(null)).toBe(false)
  })
})

describe('isExtensionMessage', () => {
  it('accepts a HELLO handshake', () => {
    expect(
      isExtensionMessage({ type: 'HELLO', token: 't', extensionId: 'abc', protocolVersion: PROTOCOL_VERSION }),
    ).toBe(true)
  })

  it('rejects an app-side type', () => {
    expect(isExtensionMessage({ type: 'EXECUTE', requestId: 'r1' })).toBe(false)
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm install
pnpm --filter @ncafe/protocol test
```

Expected: FAIL — `Failed to resolve import "../src/messages.js"`

- [ ] **Step 4: 프로토콜 구현**

`packages/protocol/src/messages.ts`:

```ts
export const PROTOCOL_VERSION = 1

/** No call may wait forever. Every value stays under the MV3 30s fetch ceiling. */
export const TIMEOUTS = {
  loginCheckMs: 10_000,
  collectMs: 15_000,
  executeMs: 15_000,
  extensionReplyMs: 20_000,
} as const

export interface SourceRef {
  readonly cafeId: string
  readonly boardId: string
}

export interface RawCandidate {
  readonly postId: string
  readonly authorNickname: string | null
  readonly authorId: string | null
  readonly postedAt: number
  /** Authors of comments already on the post. `null` means the check failed. */
  readonly existingCommentAuthors: string[] | null
}

/** Semantic action. Endpoints, tokens and selectors stay inside the extension. */
export interface ActionEnvelope {
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly body: string
}

export type AppMessage =
  | { type: 'HELLO_ACK'; accepted: boolean; reason: string | null }
  | { type: 'CHECK_LOGIN'; requestId: string }
  | { type: 'COLLECT'; requestId: string; automationId: string; source: SourceRef; sincePostId: string | null }
  | { type: 'EXECUTE'; requestId: string; automationId: string; action: ActionEnvelope }
  | { type: 'ABORT'; requestId: string }

export type ExtensionMessage =
  | { type: 'HELLO'; token: string; extensionId: string; protocolVersion: number }
  | { type: 'LOGIN_STATE'; requestId: string; loggedIn: boolean; account: string | null }
  | { type: 'COLLECTED'; requestId: string; candidates: RawCandidate[] }
  | {
      type: 'EXECUTED'
      requestId: string
      ok: boolean
      strategy: 'FETCH' | 'DOM' | null
      commentAuthors: string[] | null
      error: string | null
    }
  | { type: 'ERROR'; requestId: string | null; code: string; message: string }

const APP_MESSAGE_TYPES = new Set<AppMessage['type']>([
  'HELLO_ACK',
  'CHECK_LOGIN',
  'COLLECT',
  'EXECUTE',
  'ABORT',
])

const EXTENSION_MESSAGE_TYPES = new Set<ExtensionMessage['type']>([
  'HELLO',
  'LOGIN_STATE',
  'COLLECTED',
  'EXECUTED',
  'ERROR',
])

function messageType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

export function isAppMessage(value: unknown): value is AppMessage {
  const type = messageType(value)
  return type !== null && APP_MESSAGE_TYPES.has(type as AppMessage['type'])
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  const type = messageType(value)
  return type !== null && EXTENSION_MESSAGE_TYPES.has(type as ExtensionMessage['type'])
}
```

`packages/protocol/src/index.ts`:

```ts
export * from './messages.js'
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/protocol test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add packages/protocol pnpm-lock.yaml
git commit -m "feat(protocol): define app-extension message contract and timeout budget"
```

---

### Task 8: 데스크톱 앱 스캐폴딩과 DB 스키마

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vitest.config.ts`, `apps/desktop/drizzle.config.ts`
- Create: `apps/desktop/src/main/db/schema.ts`, `apps/desktop/src/main/db/client.ts`
- Test: `apps/desktop/tests/db/client.test.ts`

**Interfaces:**
- Consumes: `ExecutionStatus`, `ExecutionStrategy` (Task 2)
- Produces:
  - 테이블 `executions`, `templates`, `automationSettings`, `watermarks`, `appSettings`
  - `openDatabase(filePath: string): AppDatabase`
  - `type AppDatabase = BetterSQLite3Database<typeof schema>`

- [ ] **Step 1: 패키지 생성**

`apps/desktop/package.json`:

```json
{
  "name": "@ncafe/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@ncafe/core": "workspace:*",
    "@ncafe/protocol": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.36.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/ws": "^8.5.12",
    "drizzle-kit": "^0.28.0",
    "electron": "^33.0.0"
  }
}
```

`apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["node"] },
  "include": ["src/**/*"]
}
```

`apps/desktop/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Point workspace deps at source so tests never depend on build ordering.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@ncafe/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@ncafe/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)),
    },
  },
})
```

`apps/desktop/drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config
```

- [ ] **Step 2: 스키마 작성**

`apps/desktop/src/main/db/schema.ts`:

```ts
import type { ExecutionStatus, ExecutionStrategy } from '@ncafe/core'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * One post is one row for its whole life. The approval queue is a status, not a
 * separate table, so history and queue can never disagree.
 */
export const executions = sqliteTable(
  'executions',
  {
    id: text('id').primaryKey(),
    automationId: text('automation_id').notNull(),
    cafeId: text('cafe_id').notNull(),
    boardId: text('board_id').notNull(),
    targetPostId: text('target_post_id').notNull(),
    targetAuthor: text('target_author'),
    targetAuthorId: text('target_author_id'),
    targetPostedAt: integer('target_posted_at').notNull(),
    actorAccount: text('actor_account'),
    status: text('status').$type<ExecutionStatus>().notNull(),
    strategy: text('strategy').$type<ExecutionStrategy>(),
    riskFlags: text('risk_flags').notNull().default('[]'),
    reason: text('reason'),
    templateId: text('template_id'),
    renderedText: text('rendered_text'),
    attempts: integer('attempts').notNull().default(0),
    detectedAt: integer('detected_at').notNull(),
    resolvedAt: integer('resolved_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => [uniqueIndex('executions_automation_post_unique').on(table.automationId, table.targetPostId)],
)

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  automationId: text('automation_id').notNull(),
  body: text('body').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
})

export const automationSettings = sqliteTable('automation_settings', {
  automationId: text('automation_id').primaryKey(),
  policy: text('policy').notNull(),
  limitsJson: text('limits_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
})

export const watermarks = sqliteTable(
  'watermarks',
  {
    automationId: text('automation_id').notNull(),
    boardId: text('board_id').notNull(),
    lastSeenPostId: text('last_seen_post_id').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('watermarks_automation_board_unique').on(table.automationId, table.boardId)],
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

> drizzle-kit이 세 번째 인자의 반환 형태를 문제 삼으면 배열 대신 객체 형태(`(table) => ({ postUnique: uniqueIndex(...) })`)로 바꾼다. 두 형태 모두 동작하는 버전이 있고 권장 형태가 버전에 따라 다르다.

- [ ] **Step 3: DB 클라이언트 작성**

`apps/desktop/src/main/db/client.ts`:

```ts
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export type AppDatabase = BetterSQLite3Database<typeof schema>

export interface OpenDatabaseOptions {
  readonly migrationsFolder?: string
}

export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): AppDatabase {
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  if (options.migrationsFolder !== undefined) {
    migrate(db, { migrationsFolder: options.migrationsFolder })
  }
  return db
}
```

- [ ] **Step 4: 마이그레이션 생성**

```bash
pnpm install
pnpm --filter @ncafe/desktop db:generate
```

Expected: `apps/desktop/drizzle/` 아래에 `.sql` 마이그레이션과 `meta/` 디렉터리가 생성된다.

- [ ] **Step 5: 실패하는 테스트 작성**

`apps/desktop/tests/db/client.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/main/db/client.js'
import { executions } from '../../src/main/db/schema.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ncafe-db-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('creates the executions table via migrations', () => {
    expect(db.select().from(executions).all()).toEqual([])
  })

  it('enforces one row per automation and post', () => {
    const row = {
      id: 'e1',
      automationId: 'cafe-welcome-comment',
      cafeId: '10000000',
      boardId: '5',
      targetPostId: '1001',
      targetAuthor: null,
      targetAuthorId: null,
      targetPostedAt: 1,
      actorAccount: null,
      status: 'QUEUED' as const,
      strategy: null,
      riskFlags: '[]',
      reason: null,
      templateId: null,
      renderedText: null,
      attempts: 0,
      detectedAt: 1,
      resolvedAt: null,
      deletedAt: null,
    }
    db.insert(executions).values(row).run()
    expect(() => db.insert(executions).values({ ...row, id: 'e2' }).run()).toThrow(/UNIQUE/i)
  })
})
```

- [ ] **Step 6: 테스트 실행**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: 2 passed. 실패하면 Step 4의 마이그레이션이 생성되지 않은 것이다.

- [ ] **Step 7: 커밋**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "feat(desktop): add sqlite schema and migrated database client"
```

---

### Task 9: DedupeStore — 원자적 선점

**Files:**
- Create: `apps/desktop/src/main/db/dedupeStore.ts`
- Test: `apps/desktop/tests/db/dedupeStore.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (Task 8)
- Produces:
  - `ClaimInput { automationId, cafeId, boardId, postId, authorNickname, authorId, postedAt, detectedAt }`
  - `DedupeStore { claim(input): Promise<string | null> }`
  - `createSqliteDedupeStore(db: AppDatabase, newId: () => string): DedupeStore`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/desktop/tests/db/dedupeStore.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/main/db/client.js'
import { createSqliteDedupeStore, type ClaimInput } from '../../src/main/db/dedupeStore.js'
import { executions } from '../../src/main/db/schema.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

const input: ClaimInput = {
  automationId: 'cafe-welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  postId: '1001',
  authorNickname: '신입회원',
  authorId: 'member-1',
  postedAt: 1_700_000_000_000,
  detectedAt: 1_700_000_100_000,
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ncafe-dedupe-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createSqliteDedupeStore', () => {
  it('claims an unseen post and returns its execution id', async () => {
    let counter = 0
    const store = createSqliteDedupeStore(db, () => `id-${++counter}`)

    await expect(store.claim(input)).resolves.toBe('id-1')

    const rows = db.select().from(executions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('AWAITING_APPROVAL')
    expect(rows[0]?.attempts).toBe(0)
  })

  it('returns null for a post already claimed', async () => {
    let counter = 0
    const store = createSqliteDedupeStore(db, () => `id-${++counter}`)

    await store.claim(input)
    await expect(store.claim(input)).resolves.toBeNull()
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('lets exactly one of many concurrent claims win', async () => {
    let counter = 0
    const store = createSqliteDedupeStore(db, () => `id-${++counter}`)

    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(input)))
    const winners = results.filter((r) => r !== null)

    expect(winners).toHaveLength(1)
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('treats the same post id in a different automation as a separate claim', async () => {
    let counter = 0
    const store = createSqliteDedupeStore(db, () => `id-${++counter}`)

    await store.claim(input)
    await expect(store.claim({ ...input, automationId: 'other-automation' })).resolves.not.toBeNull()
    expect(db.select().from(executions).all()).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: FAIL — `Failed to resolve import ".../dedupeStore.js"`

- [ ] **Step 3: DedupeStore 구현**

`apps/desktop/src/main/db/dedupeStore.ts`:

```ts
import type { AppDatabase } from './client.js'
import { executions } from './schema.js'

export interface ClaimInput {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly authorNickname: string | null
  readonly authorId: string | null
  readonly postedAt: number
  readonly detectedAt: number
}

export interface DedupeStore {
  /**
   * Atomically takes ownership of a post. Returns the new execution id, or null
   * if someone already owns it.
   *
   * Claiming means "we handle this post", not "we finished it". Approval,
   * execution and retries are all status transitions on the row this creates —
   * retries never call claim again.
   */
  claim(input: ClaimInput): Promise<string | null>
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export function createSqliteDedupeStore(db: AppDatabase, newId: () => string): DedupeStore {
  return {
    async claim(input: ClaimInput): Promise<string | null> {
      const id = newId()
      try {
        db.insert(executions)
          .values({
            id,
            automationId: input.automationId,
            cafeId: input.cafeId,
            boardId: input.boardId,
            targetPostId: input.postId,
            targetAuthor: input.authorNickname,
            targetAuthorId: input.authorId,
            targetPostedAt: input.postedAt,
            actorAccount: null,
            // Parked until the policy engine decides; the orchestrator moves it
            // to QUEUED or SKIPPED in the same session.
            status: 'AWAITING_APPROVAL',
            strategy: null,
            riskFlags: '[]',
            reason: null,
            templateId: null,
            renderedText: null,
            attempts: 0,
            detectedAt: input.detectedAt,
            resolvedAt: null,
            deletedAt: null,
          })
          .run()
        return id
      } catch (error) {
        if (isUniqueViolation(error)) return null
        throw error
      }
    },
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop
git commit -m "feat(desktop): add atomic dedupe store backed by unique constraint"
```

---

### Task 10: executions 리포지토리

**Files:**
- Create: `apps/desktop/src/main/db/executionsRepo.ts`
- Test: `apps/desktop/tests/db/executionsRepo.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (Task 8), `ExecutionStatus`, `RiskFlag`, `UNRESOLVED_STATUSES` (Task 2)
- Produces:
  - `ExecutionPatch { status, strategy?, reason?, riskFlags?, templateId?, renderedText?, actorAccount?, attempts?, resolvedAt? }`
  - `ExecutionsRepo`:
    - `applyPatch(id: string, patch: ExecutionPatch): void`
    - `countSuccessSince(automationId: string, sinceMs: number): number`
    - `listUnresolved(automationId: string): UnresolvedRow[]`
    - `getById(id: string): ExecutionRow | undefined`
  - `createExecutionsRepo(db: AppDatabase): ExecutionsRepo`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/desktop/tests/db/executionsRepo.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/main/db/client.js'
import { createSqliteDedupeStore } from '../../src/main/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/main/db/executionsRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const AUTOMATION = 'cafe-welcome-comment'

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let counter = 0

async function claim(postId: string, postedAt: number): Promise<string> {
  const store = createSqliteDedupeStore(db, () => `id-${++counter}`)
  const id = await store.claim({
    automationId: AUTOMATION,
    cafeId: '10000000',
    boardId: '5',
    postId,
    authorNickname: 'nick',
    authorId: 'member',
    postedAt,
    detectedAt: postedAt + 1000,
  })
  if (id === null) throw new Error('claim failed in fixture')
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ncafe-repo-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('applyPatch', () => {
  it('writes status, strategy and risk flags', async () => {
    const id = await claim('1001', 1_000)
    repo.applyPatch(id, { status: 'SUCCESS', strategy: 'FETCH', riskFlags: [], resolvedAt: 2_000 })

    const row = repo.getById(id)
    expect(row?.status).toBe('SUCCESS')
    expect(row?.strategy).toBe('FETCH')
    expect(row?.resolvedAt).toBe(2_000)
  })

  it('serialises risk flags as json', async () => {
    const id = await claim('1002', 1_000)
    repo.applyPatch(id, { status: 'AWAITING_APPROVAL', riskFlags: ['STRUCTURE_CHANGED', 'COMMENT_CHECK_FAILED'] })

    expect(repo.getById(id)?.riskFlags).toEqual(['STRUCTURE_CHANGED', 'COMMENT_CHECK_FAILED'])
  })
})

describe('countSuccessSince', () => {
  it('counts only successes inside the window', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 1_000)
    const c = await claim('1003', 1_000)

    repo.applyPatch(a, { status: 'SUCCESS', resolvedAt: 5_000 })
    repo.applyPatch(b, { status: 'SUCCESS', resolvedAt: 500 })
    repo.applyPatch(c, { status: 'FAILED', resolvedAt: 6_000 })

    expect(repo.countSuccessSince(AUTOMATION, 1_000)).toBe(1)
  })
})

describe('listUnresolved', () => {
  it('returns only rows that still owe work', async () => {
    const a = await claim('1001', 1_000)
    const b = await claim('1002', 2_000)
    const c = await claim('1003', 3_000)

    repo.applyPatch(a, { status: 'QUEUED' })
    repo.applyPatch(b, { status: 'RETRY_WAIT' })
    repo.applyPatch(c, { status: 'SUCCESS', resolvedAt: 9_000 })

    const unresolved = repo.listUnresolved(AUTOMATION)
    expect(unresolved.map((r) => r.targetPostId).sort()).toEqual(['1001', '1002'])
    expect(unresolved.every((r) => typeof r.targetPostedAt === 'number')).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: FAIL — `Failed to resolve import ".../executionsRepo.js"`

- [ ] **Step 3: 리포지토리 구현**

`apps/desktop/src/main/db/executionsRepo.ts`:

```ts
import { UNRESOLVED_STATUSES, type ExecutionStatus, type ExecutionStrategy, type RiskFlag } from '@ncafe/core'
import { and, eq, gte, inArray } from 'drizzle-orm'
import type { AppDatabase } from './client.js'
import { executions } from './schema.js'

export interface ExecutionPatch {
  readonly status: ExecutionStatus
  readonly strategy?: ExecutionStrategy | null
  readonly reason?: string | null
  readonly riskFlags?: readonly RiskFlag[]
  readonly templateId?: string | null
  readonly renderedText?: string | null
  readonly actorAccount?: string | null
  readonly attempts?: number
  readonly resolvedAt?: number | null
}

export interface ExecutionRow {
  readonly id: string
  readonly automationId: string
  readonly targetPostId: string
  readonly targetPostedAt: number
  readonly status: ExecutionStatus
  readonly strategy: ExecutionStrategy | null
  readonly reason: string | null
  readonly riskFlags: RiskFlag[]
  readonly attempts: number
  readonly resolvedAt: number | null
}

export interface UnresolvedRow {
  readonly id: string
  readonly targetPostId: string
  readonly targetPostedAt: number
  readonly status: ExecutionStatus
  readonly attempts: number
}

export interface ExecutionsRepo {
  applyPatch(id: string, patch: ExecutionPatch): void
  countSuccessSince(automationId: string, sinceMs: number): number
  listUnresolved(automationId: string): UnresolvedRow[]
  getById(id: string): ExecutionRow | undefined
}

function parseFlags(raw: string): RiskFlag[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RiskFlag[]) : []
  } catch {
    return []
  }
}

export function createExecutionsRepo(db: AppDatabase): ExecutionsRepo {
  return {
    applyPatch(id, patch) {
      const values: Record<string, unknown> = { status: patch.status }
      if (patch.strategy !== undefined) values.strategy = patch.strategy
      if (patch.reason !== undefined) values.reason = patch.reason
      if (patch.riskFlags !== undefined) values.riskFlags = JSON.stringify(patch.riskFlags)
      if (patch.templateId !== undefined) values.templateId = patch.templateId
      if (patch.renderedText !== undefined) values.renderedText = patch.renderedText
      if (patch.actorAccount !== undefined) values.actorAccount = patch.actorAccount
      if (patch.attempts !== undefined) values.attempts = patch.attempts
      if (patch.resolvedAt !== undefined) values.resolvedAt = patch.resolvedAt

      db.update(executions).set(values).where(eq(executions.id, id)).run()
    },

    countSuccessSince(automationId, sinceMs) {
      return db
        .select()
        .from(executions)
        .where(
          and(
            eq(executions.automationId, automationId),
            eq(executions.status, 'SUCCESS'),
            gte(executions.resolvedAt, sinceMs),
          ),
        )
        .all().length
    },

    listUnresolved(automationId) {
      return db
        .select()
        .from(executions)
        .where(and(eq(executions.automationId, automationId), inArray(executions.status, [...UNRESOLVED_STATUSES])))
        .all()
        .map((row) => ({
          id: row.id,
          targetPostId: row.targetPostId,
          targetPostedAt: row.targetPostedAt,
          status: row.status,
          attempts: row.attempts,
        }))
    },

    getById(id) {
      const row = db.select().from(executions).where(eq(executions.id, id)).get()
      if (row === undefined) return undefined
      return {
        id: row.id,
        automationId: row.automationId,
        targetPostId: row.targetPostId,
        targetPostedAt: row.targetPostedAt,
        status: row.status,
        strategy: row.strategy,
        reason: row.reason,
        riskFlags: parseFlags(row.riskFlags),
        attempts: row.attempts,
        resolvedAt: row.resolvedAt,
      }
    },
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop
git commit -m "feat(desktop): add executions repository with status patching and queries"
```

---

### Task 11: 페어링과 WebSocket 브리지

**Files:**
- Create: `apps/desktop/src/main/ws/pairing.ts`, `apps/desktop/src/main/ws/server.ts`
- Test: `apps/desktop/tests/ws/pairing.test.ts`, `apps/desktop/tests/ws/server.test.ts`

**Interfaces:**
- Consumes: `AppMessage`, `ExtensionMessage`, `PROTOCOL_VERSION`, `isExtensionMessage` (Task 7)
- Produces:
  - `PairingState { token, boundExtensionId }`, `generateToken()`, `extensionIdFromOrigin(origin)`
  - `HelloAttempt { token, origin, protocolVersion }`, `PairingVerdict`, `verifyHello(state, attempt)`
  - `ExtensionTransport { isConnected(): boolean; request(message: AppMessage, timeoutMs: number): Promise<ExtensionMessage> }`
  - `createBridgeServer(options): Promise<BridgeServer>` where `BridgeServer extends ExtensionTransport { port: number; close(): Promise<void> }`

- [ ] **Step 1: pairing 실패 테스트 작성**

`apps/desktop/tests/ws/pairing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@ncafe/protocol'
import { extensionIdFromOrigin, generateToken, verifyHello } from '../../src/main/ws/pairing.js'

const TOKEN = 'correct-horse-battery-staple'
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'

function attempt(overrides: Partial<Parameters<typeof verifyHello>[1]> = {}) {
  return { token: TOKEN, origin: ORIGIN, protocolVersion: PROTOCOL_VERSION, ...overrides }
}

describe('generateToken', () => {
  it('produces a long, url-safe, non-repeating token', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('extensionIdFromOrigin', () => {
  it('extracts the id from a chrome-extension origin', () => {
    expect(extensionIdFromOrigin(ORIGIN)).toBe(EXT_ID)
  })

  it('rejects any other scheme', () => {
    expect(extensionIdFromOrigin('https://cafe.naver.com')).toBeNull()
    expect(extensionIdFromOrigin(undefined)).toBeNull()
  })
})

describe('verifyHello — trust on first use', () => {
  it('accepts and binds the first extension presenting the right token', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: null }, attempt())).toEqual({
      accepted: true,
      boundExtensionId: EXT_ID,
    })
  })

  it('accepts the bound extension on later connections', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: EXT_ID }, attempt())).toEqual({
      accepted: true,
      boundExtensionId: EXT_ID,
    })
  })

  it('rejects a different extension even with the right token', () => {
    const other = 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
    expect(verifyHello({ token: TOKEN, boundExtensionId: EXT_ID }, attempt({ origin: other }))).toEqual({
      accepted: false,
      reason: 'WRONG_EXTENSION',
    })
  })

  it('rejects a wrong token', () => {
    expect(verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ token: 'nope' }))).toEqual({
      accepted: false,
      reason: 'BAD_TOKEN',
    })
  })

  it('rejects a non-extension origin', () => {
    expect(
      verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ origin: 'https://evil.example' })),
    ).toEqual({ accepted: false, reason: 'BAD_ORIGIN' })
  })

  it('rejects a mismatched protocol version', () => {
    expect(
      verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ protocolVersion: PROTOCOL_VERSION + 1 })),
    ).toEqual({ accepted: false, reason: 'PROTOCOL_MISMATCH' })
  })
})
```

- [ ] **Step 2: pairing 구현**

`apps/desktop/src/main/ws/pairing.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { PROTOCOL_VERSION } from '@ncafe/protocol'

export interface PairingState {
  readonly token: string
  /** Set on the first successful handshake and never changed silently. */
  readonly boundExtensionId: string | null
}

export interface HelloAttempt {
  readonly token: string
  readonly origin: string | undefined
  readonly protocolVersion: number
}

export type PairingVerdict =
  | { accepted: true; boundExtensionId: string }
  | { accepted: false; reason: 'BAD_TOKEN' | 'WRONG_EXTENSION' | 'BAD_ORIGIN' | 'PROTOCOL_MISMATCH' }

export function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

export function extensionIdFromOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null
  const prefix = 'chrome-extension://'
  if (!origin.startsWith(prefix)) return null
  const id = origin.slice(prefix.length)
  return id.length > 0 ? id : null
}

function tokensMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Trust on first use: the first extension that presents the correct token is
 * remembered, and only that extension is accepted afterwards. This removes the
 * need to know the extension id before the store assigns one.
 */
export function verifyHello(state: PairingState, attempt: HelloAttempt): PairingVerdict {
  if (attempt.protocolVersion !== PROTOCOL_VERSION) {
    return { accepted: false, reason: 'PROTOCOL_MISMATCH' }
  }
  const extensionId = extensionIdFromOrigin(attempt.origin)
  if (extensionId === null) {
    return { accepted: false, reason: 'BAD_ORIGIN' }
  }
  if (!tokensMatch(state.token, attempt.token)) {
    return { accepted: false, reason: 'BAD_TOKEN' }
  }
  if (state.boundExtensionId !== null && state.boundExtensionId !== extensionId) {
    return { accepted: false, reason: 'WRONG_EXTENSION' }
  }
  return { accepted: true, boundExtensionId: extensionId }
}
```

- [ ] **Step 3: 테스트 실행**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: pairing 테스트 전부 PASS.

- [ ] **Step 4: 서버 실패 테스트 작성**

`apps/desktop/tests/ws/server.test.ts`:

```ts
import { PROTOCOL_VERSION, type ExtensionMessage } from '@ncafe/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createBridgeServer, type BridgeServer } from '../../src/main/ws/server.js'
import { generateToken } from '../../src/main/ws/pairing.js'

const TOKEN = generateToken()
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

let server: BridgeServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function connect(token: string, origin: string): Promise<WebSocket> {
  if (server === undefined) throw new Error('server not started')
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin })
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ type: 'HELLO', token, extensionId: 'ignored', protocolVersion: PROTOCOL_VERSION }))
  return ws
}

async function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data)) as Record<string, unknown>))
  })
}

describe('createBridgeServer', () => {
  it('acknowledges a valid handshake', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN, ORIGIN)

    expect(await nextMessage(ws)).toEqual({ type: 'HELLO_ACK', accepted: true, reason: null })
    expect(server.isConnected()).toBe(true)
    ws.close()
  })

  it('rejects a bad token and reports not connected', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect('wrong-token', ORIGIN)

    const ack = await nextMessage(ws)
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toBe('BAD_TOKEN')
    expect(server.isConnected()).toBe(false)
  })

  it('round-trips a request and its reply', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN, ORIGIN)
    await nextMessage(ws)

    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string; requestId?: string }
      if (msg.type === 'CHECK_LOGIN' && msg.requestId !== undefined) {
        ws.send(JSON.stringify({ type: 'LOGIN_STATE', requestId: msg.requestId, loggedIn: true, account: 'cafe-ops' }))
      }
    })

    const reply = (await server.request(
      { type: 'CHECK_LOGIN', requestId: 'r1' },
      1_000,
    )) as Extract<ExtensionMessage, { type: 'LOGIN_STATE' }>

    expect(reply.loggedIn).toBe(true)
    expect(reply.account).toBe('cafe-ops')
    ws.close()
  })

  it('rejects a request that gets no reply before the timeout', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN, ORIGIN)
    await nextMessage(ws)

    await expect(server.request({ type: 'CHECK_LOGIN', requestId: 'r2' }, 50)).rejects.toThrow(/timed out/i)
    ws.close()
  })

  it('rejects a request when no extension is connected', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    await expect(server.request({ type: 'CHECK_LOGIN', requestId: 'r3' }, 50)).rejects.toThrow(/not connected/i)
  })
})
```

- [ ] **Step 5: 서버 구현**

`apps/desktop/src/main/ws/server.ts`:

```ts
import { isExtensionMessage, type AppMessage, type ExtensionMessage } from '@ncafe/protocol'
import { WebSocketServer, type WebSocket } from 'ws'
import { verifyHello, type PairingState } from './pairing.js'

export interface ExtensionTransport {
  isConnected(): boolean
  request(message: AppMessage, timeoutMs: number): Promise<ExtensionMessage>
}

export interface BridgeServer extends ExtensionTransport {
  readonly port: number
  close(): Promise<void>
}

export interface BridgeServerOptions extends PairingState {
  /** 0 lets the OS pick a free port, which keeps tests independent. */
  readonly port?: number
  readonly onBind?: (extensionId: string) => void
}

interface Pending {
  resolve(message: ExtensionMessage): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

function requestIdOf(message: AppMessage): string | null {
  return 'requestId' in message ? message.requestId : null
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServer> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: options.port ?? 0 })
  const pending = new Map<string, Pending>()
  let peer: WebSocket | null = null
  let bound = options.boundExtensionId

  await new Promise<void>((resolve) => wss.once('listening', resolve))

  wss.on('connection', (socket, req) => {
    let authorised = false

    socket.on('message', (data) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(data))
      } catch {
        return
      }
      if (!isExtensionMessage(parsed)) return

      if (parsed.type === 'HELLO') {
        const verdict = verifyHello(
          { token: options.token, boundExtensionId: bound },
          { token: parsed.token, origin: req.headers.origin, protocolVersion: parsed.protocolVersion },
        )
        const ack: AppMessage = {
          type: 'HELLO_ACK',
          accepted: verdict.accepted,
          reason: verdict.accepted ? null : verdict.reason,
        }
        socket.send(JSON.stringify(ack))
        if (!verdict.accepted) {
          socket.close()
          return
        }
        authorised = true
        peer = socket
        if (bound === null) {
          bound = verdict.boundExtensionId
          options.onBind?.(verdict.boundExtensionId)
        }
        return
      }

      if (!authorised) return
      if (parsed.type === 'ERROR' && parsed.requestId === null) return

      const waiting = pending.get(parsed.requestId)
      if (waiting === undefined) return
      clearTimeout(waiting.timer)
      pending.delete(parsed.requestId)
      waiting.resolve(parsed)
    })

    socket.on('close', () => {
      if (peer === socket) peer = null
    })
  })

  return {
    port: (wss.address() as { port: number }).port,

    isConnected() {
      return peer !== null
    },

    request(message, timeoutMs) {
      const socket = peer
      if (socket === null) {
        return Promise.reject(new Error('extension is not connected'))
      }
      const requestId = requestIdOf(message)
      if (requestId === null) {
        return Promise.reject(new Error('message has no requestId and cannot be awaited'))
      }

      return new Promise<ExtensionMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`request ${message.type} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        pending.set(requestId, { resolve, reject, timer })
        socket.send(JSON.stringify(message))
      })
    },

    async close() {
      for (const [, waiting] of pending) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error('bridge server closed'))
      }
      pending.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/desktop
git commit -m "feat(desktop): add websocket bridge with trust-on-first-use pairing"
```

---

### Task 12: 확장 스켈레톤

**Files:**
- Create: `apps/extension/package.json`, `apps/extension/tsconfig.json`, `apps/extension/vite.config.ts`, `apps/extension/vitest.config.ts`
- Create: `apps/extension/manifest.json`, `apps/extension/src/background.ts`, `apps/extension/src/stub.ts`
- Test: `apps/extension/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `AppMessage`, `ExtensionMessage`, `PROTOCOL_VERSION`, `RawCandidate` (Task 7)
- Produces: 빌드된 `dist/background.js`와 `dist/manifest.json`. Phase 3에서 `stub.ts`를 실제 수집·실행 구현으로 교체한다

- [ ] **Step 1: 패키지와 매니페스트 생성**

`apps/extension/package.json`:

```json
{
  "name": "@ncafe/extension",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@ncafe/protocol": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.280",
    "vite": "^5.4.0"
  }
}
```

`apps/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Cafe Automation Bridge",
  "version": "0.0.1",
  "description": "Bridges the cafe automation desktop app to the logged-in browser session.",
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["alarms", "storage"],
  "host_permissions": ["https://cafe.naver.com/*", "https://apis.naver.com/*"]
}
```

> `cookies` 권한은 **절대 추가하지 않는다.** 세션 쿠키를 브라우저 밖으로 내보내지 않는다는 원칙을 코드 수준에서 강제하는 장치다. Step 4의 테스트가 이를 감시한다.

`apps/extension/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": ".", "types": ["chrome", "node"], "lib": ["ES2022", "DOM"] },
  "include": ["src/**/*", "tests/**/*"]
}
```

`apps/extension/vite.config.ts`:

```ts
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@ncafe/protocol': here('../../packages/protocol/src/index.ts') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { background: here('src/background.ts') },
      output: { entryFileNames: '[name].js', format: 'es' },
    },
  },
  plugins: [
    {
      name: 'copy-manifest',
      closeBundle() {
        copyFileSync(here('manifest.json'), here('dist/manifest.json'))
      },
    },
  ],
})
```

`apps/extension/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@ncafe/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)),
    },
  },
})
```

- [ ] **Step 2: 스텁 응답기 작성**

`apps/extension/src/stub.ts`:

```ts
import type { RawCandidate } from '@ncafe/protocol'

/**
 * Phase 2 placeholder. Phase 3 replaces this with real collection against the
 * cafe endpoints, once the response schema has been observed with a logged-in
 * session. Nothing here talks to naver.
 */
export function stubCandidates(sincePostId: string | null): RawCandidate[] {
  const base = sincePostId === null ? 1000 : Number(sincePostId)
  return [
    {
      postId: String(base + 1),
      authorNickname: 'stub-member',
      authorId: 'stub-1',
      postedAt: 1_700_000_000_000,
      existingCommentAuthors: [],
    },
  ]
}
```

- [ ] **Step 3: 백그라운드 워커 작성**

`apps/extension/src/background.ts`:

```ts
import { PROTOCOL_VERSION, isAppMessage, type AppMessage, type ExtensionMessage } from '@ncafe/protocol'
import { stubCandidates } from './stub.js'

const BRIDGE_URL = 'ws://127.0.0.1:39217'
const RECONNECT_ALARM = 'bridge-reconnect'
const RECONNECT_PERIOD_MINUTES = 1

let socket: WebSocket | null = null

function send(message: ExtensionMessage): void {
  socket?.send(JSON.stringify(message))
}

async function readToken(): Promise<string | null> {
  const stored = await chrome.storage.local.get('pairingToken')
  const token: unknown = stored.pairingToken
  return typeof token === 'string' ? token : null
}

function handle(message: AppMessage): void {
  switch (message.type) {
    case 'HELLO_ACK':
      if (!message.accepted) {
        console.warn('[bridge] handshake rejected:', message.reason)
        socket?.close()
      }
      return

    case 'CHECK_LOGIN':
      send({ type: 'LOGIN_STATE', requestId: message.requestId, loggedIn: true, account: 'stub-operator' })
      return

    case 'COLLECT':
      send({ type: 'COLLECTED', requestId: message.requestId, candidates: stubCandidates(message.sincePostId) })
      return

    case 'EXECUTE':
      send({
        type: 'EXECUTED',
        requestId: message.requestId,
        ok: true,
        strategy: 'FETCH',
        commentAuthors: [],
        error: null,
      })
      return

    case 'ABORT':
      return
  }
}

async function connect(): Promise<void> {
  if (socket !== null && socket.readyState <= WebSocket.OPEN) return

  const token = await readToken()
  if (token === null) return

  const ws = new WebSocket(BRIDGE_URL)
  socket = ws

  ws.addEventListener('open', () => {
    send({ type: 'HELLO', token, extensionId: chrome.runtime.id, protocolVersion: PROTOCOL_VERSION })
  })

  ws.addEventListener('message', (event) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (isAppMessage(parsed)) handle(parsed)
  })

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null
  })
}

/**
 * The only timer in the extension. WebSocket traffic keeps the service worker
 * alive during a session (Chrome 116+), but between sessions the worker is torn
 * down and takes the socket with it. The app cannot wake a dead worker, so the
 * extension re-establishes the connection on its own.
 */
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_PERIOD_MINUTES })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connect()
})
chrome.runtime.onStartup.addListener(() => void connect())
chrome.runtime.onInstalled.addListener(() => void connect())
void connect()
```

- [ ] **Step 4: 매니페스트 불변식 테스트 작성**

`apps/extension/tests/manifest.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf8'),
) as { manifest_version: number; permissions: string[]; host_permissions: string[] }

describe('extension manifest', () => {
  it('targets manifest v3', () => {
    expect(manifest.manifest_version).toBe(3)
  })

  it('never requests the cookies permission', () => {
    // Session cookies must never leave the browser. Without this permission the
    // extension physically cannot read them, which is the point.
    expect(manifest.permissions).not.toContain('cookies')
  })

  it('limits host permissions to the cafe origins it needs', () => {
    expect(manifest.host_permissions).toEqual([
      'https://cafe.naver.com/*',
      'https://apis.naver.com/*',
    ])
  })
})
```

- [ ] **Step 5: 테스트와 빌드 확인**

```bash
pnpm install
pnpm --filter @ncafe/extension test
pnpm --filter @ncafe/extension build
```

Expected: 3 passed. `apps/extension/dist/`에 `background.js`와 `manifest.json`이 생성된다.

- [ ] **Step 6: 커밋**

```bash
git add apps/extension pnpm-lock.yaml
git commit -m "feat(extension): add mv3 skeleton with bridge client and reconnect alarm"
```

---

### Task 13: 세션 오케스트레이터 — 왕복 완성

**Files:**
- Create: `apps/desktop/src/main/orchestrator.ts`
- Test: `apps/desktop/tests/orchestrator.test.ts`

**Interfaces:**
- Consumes: core 전체 (Tasks 2~6), `ExtensionTransport` (Task 11), `DedupeStore` (Task 9), `ExecutionsRepo` (Task 10), `TIMEOUTS` (Task 7)
- Produces:
  - `SessionDeps`, `SessionOutcome`
  - `runSession(deps: SessionDeps): Promise<SessionOutcome>`

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/desktop/tests/orchestrator.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILES, operatorAlreadyCommentedGuard, type Clock, type Random, type TimeParts } from '@ncafe/core'
import type { AppMessage, ExtensionMessage, RawCandidate } from '@ncafe/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/client.js'
import { createSqliteDedupeStore } from '../src/main/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../src/main/db/executionsRepo.js'
import { runSession, type SessionDeps } from '../src/main/orchestrator.js'

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url))
const DAY_MS = 86_400_000
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

class TestClock implements Clock {
  constructor(private current: number) {}
  now(): number { return this.current }
  parts(epochMs: number): TimeParts {
    const d = new Date(epochMs)
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayOfWeek: d.getUTCDay() }
  }
  atHour(epochMs: number, hour: number): number {
    const d = new Date(epochMs)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0)
  }
  addDays(epochMs: number, days: number): number { return epochMs + days * DAY_MS }
}

const fixedRandom: Random = { intInclusive: (min) => min }

interface FakeTransportOptions {
  loggedIn?: boolean
  candidates?: RawCandidate[]
  executeOk?: boolean
}

function fakeTransport(options: FakeTransportOptions = {}) {
  const sent: AppMessage[] = []
  const transport = {
    isConnected: () => true,
    request(message: AppMessage): Promise<ExtensionMessage> {
      sent.push(message)
      if (message.type === 'CHECK_LOGIN') {
        return Promise.resolve({
          type: 'LOGIN_STATE',
          requestId: message.requestId,
          loggedIn: options.loggedIn ?? true,
          account: 'cafe-ops',
        })
      }
      if (message.type === 'COLLECT') {
        return Promise.resolve({
          type: 'COLLECTED',
          requestId: message.requestId,
          candidates: options.candidates ?? [],
        })
      }
      if (message.type === 'EXECUTE') {
        const ok = options.executeOk ?? true
        return Promise.resolve({
          type: 'EXECUTED',
          requestId: message.requestId,
          ok,
          strategy: ok ? 'FETCH' : null,
          commentAuthors: [],
          error: ok ? null : 'boom',
        })
      }
      return Promise.reject(new Error(`unexpected message ${message.type}`))
    },
  }
  return { transport, sent }
}

function candidate(postId: string, postedAt = MON_10_00 - 60_000): RawCandidate {
  return { postId, authorNickname: 'nick', authorId: 'm1', postedAt, existingCommentAuthors: [] }
}

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let idCounter = 0

function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    automationId: 'cafe-welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    policy: 'AUTO',
    limits: PROFILES.production,
    guards: [operatorAlreadyCommentedGuard],
    operatorAccounts: ['cafe-ops'],
    clock: new TestClock(MON_10_00),
    random: fixedRandom,
    transport: fakeTransport().transport,
    dedupe: createSqliteDedupeStore(db, () => `exec-${++idCounter}`),
    repo,
    renderBody: (c) => ({ templateId: 'tpl-1', body: `${c.authorNickname ?? ''}님 환영합니다` }),
    isKilled: () => false,
    sleep: () => Promise.resolve(),
    newRequestId: () => `req-${++idCounter}`,
    watermark: null,
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ncafe-orch-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  idCounter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runSession — gates before opening', () => {
  it('does not open when the kill switch is engaged', async () => {
    const outcome = await runSession(deps({ isKilled: () => true }))
    expect(outcome).toEqual({ opened: false, reason: 'KILLED' })
  })

  it('does not open outside the operating window', async () => {
    const outcome = await runSession(deps({ clock: new TestClock(Date.UTC(2026, 7, 24, 3, 0, 0)) }))
    expect(outcome).toEqual({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })
  })

  it('does not open when the operator is logged out', async () => {
    const outcome = await runSession(deps({ transport: fakeTransport({ loggedIn: false }).transport }))
    expect(outcome).toEqual({ opened: false, reason: 'NOT_LOGGED_IN' })
  })

  it('does not open when the login check itself fails', async () => {
    const transport = { isConnected: () => true, request: () => Promise.reject(new Error('timed out')) }
    const outcome = await runSession(deps({ transport }))
    expect(outcome).toEqual({ opened: false, reason: 'LOGIN_CHECK_FAILED' })
  })
})

describe('runSession — AUTO policy', () => {
  it('executes clean candidates and records success with strategy', async () => {
    const { transport } = fakeTransport({ candidates: [candidate('1001'), candidate('1002')] })
    const outcome = await runSession(deps({ transport }))

    expect(outcome).toMatchObject({ opened: true, executed: 2, skipped: 0, awaitingApproval: 0, failed: 0 })

    const rows = repo.listUnresolved('cafe-welcome-comment')
    expect(rows).toHaveLength(0)
  })

  it('skips a post an operator already greeted', async () => {
    const already = { ...candidate('1003'), existingCommentAuthors: ['cafe-ops'] }
    const { transport } = fakeTransport({ candidates: [already] })

    const outcome = await runSession(deps({ transport }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1 })
  })

  it('skips rather than queues when the comment check failed', async () => {
    const unchecked = { ...candidate('1004'), existingCommentAuthors: null }
    const { transport } = fakeTransport({ candidates: [unchecked] })

    const outcome = await runSession(deps({ transport, policy: 'AUTO' }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 1, awaitingApproval: 0 })
  })
})

describe('runSession — SEMI and MANUAL policies', () => {
  it('queues a flagged candidate for approval under SEMI', async () => {
    const unchecked = { ...candidate('1005'), existingCommentAuthors: null }
    const { transport } = fakeTransport({ candidates: [unchecked] })

    const outcome = await runSession(deps({ transport, policy: 'SEMI' }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, awaitingApproval: 1 })
  })

  it('queues every candidate for approval under MANUAL', async () => {
    const { transport } = fakeTransport({ candidates: [candidate('1006')] })

    const outcome = await runSession(deps({ transport, policy: 'MANUAL' }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, awaitingApproval: 1 })
  })
})

describe('runSession — caps and failures', () => {
  it('stops at the per-session cap and leaves the rest queued', async () => {
    const many = Array.from({ length: 4 }, (_, i) => candidate(`20${i}`))
    const { transport } = fakeTransport({ candidates: many })
    const limits = { ...PROFILES.production, perSessionCap: 2 }

    const outcome = await runSession(deps({ transport, limits }))
    expect(outcome).toMatchObject({ opened: true, executed: 2 })
    // The candidate that hit the cap stays QUEUED; the ones after it are never
    // claimed at all and will simply be collected again next session.
    expect(repo.listUnresolved('cafe-welcome-comment')).toHaveLength(1)
  })

  it('expires candidates once the daily cap is reached', async () => {
    const { transport } = fakeTransport({ candidates: [candidate('3001')] })
    const limits = { ...PROFILES.production, dailyCap: 0 }

    const outcome = await runSession(deps({ transport, limits }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, expired: 1 })
  })

  it('parks a failed execution in RETRY_WAIT rather than failing outright', async () => {
    const { transport } = fakeTransport({ candidates: [candidate('4001')], executeOk: false })

    const outcome = await runSession(deps({ transport }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, failed: 0 })

    const unresolved = repo.listUnresolved('cafe-welcome-comment')
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.status).toBe('RETRY_WAIT')
    expect(unresolved[0]?.attempts).toBe(1)
  })

  it('does not open when unresolved work has grown stale', async () => {
    const first = fakeTransport({ candidates: [candidate('5001', MON_10_00 - 30 * 3_600_000)], executeOk: false })
    await runSession(deps({ transport: first.transport }))

    const second = fakeTransport({ candidates: [] })
    const outcome = await runSession(deps({ transport: second.transport }))
    expect(outcome).toEqual({ opened: false, reason: 'STALE_BACKLOG' })
  })
})

describe('runSession — dedupe', () => {
  it('ignores a post that was already claimed in an earlier session', async () => {
    const first = fakeTransport({ candidates: [candidate('6001')] })
    await runSession(deps({ transport: first.transport }))

    const second = fakeTransport({ candidates: [candidate('6001')] })
    const outcome = await runSession(deps({ transport: second.transport }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 0 })
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: FAIL — `Failed to resolve import ".../orchestrator.js"`

- [ ] **Step 3: 오케스트레이터 구현**

`apps/desktop/src/main/orchestrator.ts`:

```ts
import {
  checkGates,
  dailyWindowStart,
  decide,
  evaluateGuards,
  hasStaleBacklog,
  initialStatus,
  isWithinActiveHours,
  nextActionDelayMs,
  transition,
  type ApprovalPolicy,
  type Candidate,
  type Clock,
  type Guard,
  type Limits,
  type Random,
} from '@ncafe/core'
import { TIMEOUTS, type ExtensionMessage, type RawCandidate } from '@ncafe/protocol'
import type { DedupeStore } from './db/dedupeStore.js'
import type { ExecutionsRepo } from './db/executionsRepo.js'
import type { ExtensionTransport } from './ws/server.js'

export interface SessionDeps {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly policy: ApprovalPolicy
  readonly limits: Limits
  readonly guards: readonly Guard[]
  readonly operatorAccounts: readonly string[]
  readonly clock: Clock
  readonly random: Random
  readonly transport: ExtensionTransport
  readonly dedupe: DedupeStore
  readonly repo: ExecutionsRepo
  readonly renderBody: (candidate: Candidate) => { templateId: string; body: string }
  readonly isKilled: () => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly newRequestId: () => string
  readonly watermark: string | null
}

export type SessionRefusal =
  | 'KILLED'
  | 'OUTSIDE_ACTIVE_HOURS'
  | 'NOT_LOGGED_IN'
  | 'LOGIN_CHECK_FAILED'
  | 'STALE_BACKLOG'
  | 'COLLECT_FAILED'

export type SessionOutcome =
  | { opened: false; reason: SessionRefusal }
  | {
      opened: true
      executed: number
      skipped: number
      awaitingApproval: number
      failed: number
      expired: number
    }

async function checkLogin(deps: SessionDeps): Promise<'IN' | 'OUT' | 'UNKNOWN'> {
  try {
    const reply = await deps.transport.request(
      { type: 'CHECK_LOGIN', requestId: deps.newRequestId() },
      TIMEOUTS.loginCheckMs,
    )
    if (reply.type !== 'LOGIN_STATE') return 'UNKNOWN'
    return reply.loggedIn ? 'IN' : 'OUT'
  } catch {
    return 'UNKNOWN'
  }
}

async function collect(deps: SessionDeps): Promise<RawCandidate[] | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'COLLECT',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        source: { cafeId: deps.cafeId, boardId: deps.boardId },
        sincePostId: deps.watermark,
      },
      TIMEOUTS.collectMs,
    )
    return reply.type === 'COLLECTED' ? reply.candidates : null
  } catch {
    return null
  }
}

async function execute(
  deps: SessionDeps,
  candidate: Candidate,
  body: string,
): Promise<Extract<ExtensionMessage, { type: 'EXECUTED' }> | null> {
  try {
    const reply = await deps.transport.request(
      {
        type: 'EXECUTE',
        requestId: deps.newRequestId(),
        automationId: deps.automationId,
        action: {
          cafeId: candidate.cafeId,
          boardId: candidate.boardId,
          postId: candidate.postId,
          body,
        },
      },
      TIMEOUTS.executeMs,
    )
    return reply.type === 'EXECUTED' ? reply : null
  } catch {
    return null
  }
}

export async function runSession(deps: SessionDeps): Promise<SessionOutcome> {
  if (deps.isKilled()) {
    return { opened: false, reason: 'KILLED' }
  }

  const openedAt = deps.clock.now()
  if (!isWithinActiveHours(openedAt, deps.limits, deps.clock)) {
    return { opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' }
  }

  const login = await checkLogin(deps)
  if (login === 'OUT') return { opened: false, reason: 'NOT_LOGGED_IN' }
  if (login === 'UNKNOWN') return { opened: false, reason: 'LOGIN_CHECK_FAILED' }

  const unresolved = deps.repo.listUnresolved(deps.automationId)
  if (hasStaleBacklog(unresolved.map((r) => ({ postedAt: r.targetPostedAt })), openedAt, deps.limits)) {
    return { opened: false, reason: 'STALE_BACKLOG' }
  }

  const raws = await collect(deps)
  if (raws === null) return { opened: false, reason: 'COLLECT_FAILED' }

  let executed = 0
  let skipped = 0
  let awaitingApproval = 0
  let failed = 0
  let expired = 0

  const dailyStart = dailyWindowStart(openedAt, deps.limits, deps.clock)
  let dailyCount = deps.repo.countSuccessSince(deps.automationId, dailyStart)

  for (const raw of raws) {
    const now = deps.clock.now()

    const executionId = await deps.dedupe.claim({
      automationId: deps.automationId,
      cafeId: deps.cafeId,
      boardId: deps.boardId,
      postId: raw.postId,
      authorNickname: raw.authorNickname,
      authorId: raw.authorId,
      postedAt: raw.postedAt,
      detectedAt: now,
    })
    if (executionId === null) continue

    const candidate: Candidate = {
      automationId: deps.automationId,
      cafeId: deps.cafeId,
      boardId: deps.boardId,
      postId: raw.postId,
      authorNickname: raw.authorNickname,
      authorId: raw.authorId,
      postedAt: raw.postedAt,
    }

    const evaluation = evaluateGuards(deps.guards, candidate, {
      nowMs: now,
      operatorAccounts: deps.operatorAccounts,
      existingCommentAuthors: raw.existingCommentAuthors,
    })
    const disposition = decide(deps.policy, evaluation)
    const status = initialStatus(disposition)

    if (status === 'SKIPPED') {
      deps.repo.applyPatch(executionId, {
        status,
        reason: disposition.kind === 'SKIP' ? disposition.reason : null,
        riskFlags: evaluation.flags,
        resolvedAt: now,
      })
      skipped += 1
      continue
    }

    if (status === 'AWAITING_APPROVAL') {
      deps.repo.applyPatch(executionId, { status, riskFlags: evaluation.flags })
      awaitingApproval += 1
      continue
    }

    const gate = checkGates(
      { killed: deps.isKilled(), dailyCount, sessionCount: executed },
      deps.limits,
    )
    if (!gate.allowed) {
      if (gate.reason === 'SESSION_CAP_REACHED') {
        deps.repo.applyPatch(executionId, { status: 'QUEUED', riskFlags: evaluation.flags })
        break
      }
      if (gate.reason === 'KILLED') {
        deps.repo.applyPatch(executionId, {
          status: transition('QUEUED', { type: 'KILLED' }, deps.limits),
          reason: 'KILLED',
          resolvedAt: now,
        })
        break
      }
      deps.repo.applyPatch(executionId, {
        status: transition('QUEUED', { type: 'DAILY_CAP_EXCEEDED' }, deps.limits),
        reason: 'DAILY_CAP_EXCEEDED',
        resolvedAt: now,
      })
      expired += 1
      continue
    }

    deps.repo.applyPatch(executionId, { status: 'QUEUED', riskFlags: evaluation.flags })
    await deps.sleep(nextActionDelayMs(deps.limits, deps.random))

    const rendered = deps.renderBody(candidate)
    const result = await execute(deps, candidate, rendered.body)
    const attempts = 1
    const finishedAt = deps.clock.now()

    if (result !== null && result.ok) {
      deps.repo.applyPatch(executionId, {
        status: transition('QUEUED', { type: 'EXECUTION_SUCCEEDED' }, deps.limits),
        strategy: result.strategy,
        templateId: rendered.templateId,
        renderedText: rendered.body,
        attempts,
        resolvedAt: finishedAt,
      })
      executed += 1
      dailyCount += 1
      continue
    }

    const nextStatus = transition('QUEUED', { type: 'EXECUTION_FAILED', attempts }, deps.limits)
    deps.repo.applyPatch(executionId, {
      status: nextStatus,
      templateId: rendered.templateId,
      renderedText: rendered.body,
      attempts,
      reason: result?.error ?? 'NO_REPLY',
      resolvedAt: nextStatus === 'FAILED' ? finishedAt : null,
    })
    if (nextStatus === 'FAILED') failed += 1
  }

  return { opened: true, executed, skipped, awaitingApproval, failed, expired }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @ncafe/desktop test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 전체 파이프라인 확인**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

Expected: 네 명령 모두 exit 0. `@ncafe/core` 커버리지 80% 이상.

- [ ] **Step 6: 커밋**

```bash
git add apps/desktop
git commit -m "feat(desktop): add session orchestrator wiring policy, gates, and execution"
```

---

## 이 계획이 끝나면 확보되는 것

- 순수 함수로 구현되고 전부 단위 테스트된 판단 로직 — 스케줄, 총량 게이트, guard, 승인 정책, 상태 기계
- 원자적 선점과 상태 전이가 동작하는 SQLite 저장소
- TOFU 페어링이 걸린 앱↔확장 WebSocket 브리지
- `cookies` 권한이 없음을 테스트로 강제하는 MV3 확장 스켈레톤
- 스텁 확장을 상대로 세션 한 바퀴가 실제로 도는 오케스트레이터

## 이 계획이 다루지 않는 것

- **네이버 실제 엔드포인트와 파서** — 후속 계획 B. 운영 계정으로 로그인한 크롬의 DevTools Network에서 요청·응답을 관찰해 스키마를 확정한 뒤에 작성한다. 관찰 없이 쓰면 추측 구현이 된다
- **Electron 셸, 트레이, 렌더러 UI, 승인 큐 화면, 템플릿 편집, 긴급 회수 UI** — 후속 계획 C
- **워터마크 갱신과 재시도 스케줄링의 영속화** — 계획 C에서 세션 루프를 Electron 메인에 붙일 때 함께 구현한다. 이 계획의 `runSession`은 워터마크를 입력으로만 받는다
- **온라인 DB 동기화와 통계 대시보드** — 스펙 12절, 별도 스펙
