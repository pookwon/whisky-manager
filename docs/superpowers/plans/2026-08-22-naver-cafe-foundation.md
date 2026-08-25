# 네이버 카페 자동화 — 기반 구현 계획 (Phase 0~2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판단 계층(정책·게이트·스케줄러·상태 기계)과 앱↔확장 프로토콜·페어링, SQLite 상태 저장을 구축해 확장 스텁이 보낸 후보가 정책 판정을 거쳐 DB에 기록되고 실행 지시로 돌아오는 왕복을 완성한다.

**Architecture:** 판단과 스케줄은 전부 Electron 앱(Node)에, 수집과 실행은 확장에 둔다. 판단 로직은 `src/shared`에 순수 함수로 격리하고 시계·난수를 포트로 주입해 브라우저·DB·네이버 없이 전부 단위 테스트한다. 앱과 확장은 `src/shared/protocol.ts`의 판별 유니온 메시지로만 통신한다.

**Tech Stack:** 단일 pnpm 패키지, TypeScript 5.9, Vitest 4, Vite 8, Electron, better-sqlite3, Drizzle ORM, `ws`

**설계 근거:** `docs/superpowers/specs/2026-08-22-naver-cafe-automation-design.md`
**스택 근거:** `docs/tech-stack.md`

## 개정 이력

초안은 pnpm 워크스페이스에 패키지 5개로 나누고 `Automation` 플러그인 인터페이스를 먼저 세웠다. 설계 리뷰 후 두 가지를 철회했다.

- **패키지 분할 철회** — 소수 인원 유지보수 요구와 상충한다. 단일 패키지 + 폴더 경계로 간다
- **`Automation` 인터페이스 철회** — 2번째 기능(등업 승인, 글 삭제, 정기 공지)부터 이미 맞지 않는다. 비용만 지불하고 확장성은 못 얻는다. 2번째 자동화가 생길 때 실제 공통점을 보고 추출한다

판단 계층은 자동화 종류와 무관하므로 그대로 일반화해 둔다.

## Global Constraints

- **확장 매니페스트에 `cookies` 권한을 넣지 않는다.** 세션 쿠키를 브라우저 밖으로 반출하지 않는다는 원칙의 코드 수준 강제다 (스펙 4.4절). Task 12의 테스트가 감시한다
- `src/shared`는 Electron·브라우저·DB 어디에도 의존하지 않는다. 앱과 확장 양쪽이 임포트하므로 Node 전용 모듈과 브라우저 전용 API를 모두 배제한다
- 의존 방향은 단방향이다 — `src/shared` ← `src/desktop`, `src/shared` ← `src/extension`. 역방향과 desktop↔extension 직접 참조는 없다
- **임포트는 상대 경로를 쓴다.** 경로 별칭은 tsc·vite·vitest 세 곳에 설정을 중복시킨다
- `production` 프로파일: 세션 주기 45~75분, 세션 내 간격 8~25초, 세션당 상한 15건, 일일 상한 200건, 운영 시간대 08:00~24:00, 주말 세션 주기 배율 1.5
- `debug` 프로파일: 세션 주기 2~4분, 세션 내 간격 3~8초, 세션당 상한 5건
- 타임아웃: 로그인 확인 10초, 목록 수집 15초, 댓글 실행 15초, 확장 응답 전반 20초. **무한 대기는 어디에도 없다**
- 재시도 최대 3회. 승인 큐 만료 48시간. 백로그 브레이크 24시간
- TypeScript는 5.9에 고정한다. typescript-eslint 8.67의 peer가 `<6.1.0`이라 TS 7을 쓰면 린트가 깨진다
- 커밋 메시지에 AI 서명·공동저자·이모지를 넣지 않는다. 코드와 주석은 영어, 커밋 메시지는 conventional commits

## File Structure

```
whisky-manager/
├── package.json              하나
├── tsconfig.json             타입체크 (src + tests)
├── tsconfig.build.json       데스크톱 빌드 (src/extension 제외)
├── vitest.config.ts
├── eslint.config.js
├── drizzle.config.ts         Task 8
├── drizzle/                  생성된 마이그레이션
├── src/
│   ├── shared/               순수 TS. 의존성 없음
│   │   ├── types.ts          도메인 타입, 상태 enum, Limits, Candidate
│   │   ├── ports.ts          Clock / Random 포트
│   │   ├── profiles.ts       production / debug 값
│   │   ├── schedule.ts       세션 주기·지터·운영 시간대·주말 배율
│   │   ├── limits.ts         총량 게이트, 백로그 브레이크
│   │   ├── guards.ts         Guard 타입, 평가기
│   │   ├── policy.ts         승인 정책 → 처분 결정
│   │   ├── statusMachine.ts  상태 전이
│   │   ├── protocol.ts       앱↔확장 메시지 계약, 타임아웃 예산
│   │   └── index.ts          배럴
│   ├── desktop/
│   │   ├── db/schema.ts      Drizzle 스키마
│   │   ├── db/client.ts      연결·마이그레이션
│   │   ├── db/dedupeStore.ts 원자적 선점
│   │   ├── db/executionsRepo.ts
│   │   ├── ws/pairing.ts     토큰 생성·검증, TOFU
│   │   ├── ws/server.ts      WebSocket 서버
│   │   └── orchestrator.ts   세션 조립
│   └── extension/
│       ├── manifest.json     MV3. cookies 권한 없음
│       ├── background.ts     WS 클라이언트 + alarms 재연결
│       └── stub.ts           Phase 2 검증용. Phase 3에서 교체
└── tests/
    ├── shared/
    ├── desktop/
    └── extension/
```

`src/shared/automations/welcome-comment/`는 Phase 3에서 생긴다. 이 계획의 범위 밖이다.

---

### Task 1: 단일 패키지 스캐폴딩 — **완료됨**

이 태스크는 이미 저장소에 반영되어 있다. 아래는 확인용이며, 새로 만들 것은 없다.

**Files:** `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `src/shared/index.ts`, `tests/shared/smoke.test.ts`

**Produces:** `pnpm build` / `test` / `lint` / `typecheck` 스크립트

- [x] **Step 1: 파이프라인 확인**

```bash
pnpm install && pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

Expected: 네 명령 모두 exit 0. 테스트 1 passed. `dist/shared/index.js` 생성.

실패하면 다음 태스크로 넘어가지 말고 여기서 고친다.

---

### Task 2: 도메인 타입과 포트

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ports.ts`, `src/shared/profiles.ts`
- Modify: `src/shared/index.ts`
- Test: `tests/shared/profiles.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `ApprovalPolicy`, `ExecutionStatus`, `UNRESOLVED_STATUSES`, `isUnresolved`, `RiskFlag`, `SkipReason`, `GateBlockReason`, `ExecutionStrategy`, `Candidate`, `Template`, `Limits`, `Profile`
  - `Clock` (`now`, `parts`, `atHour`, `addDays`), `TimeParts`, `Random` (`intInclusive`)
  - `PROFILES: Record<Profile, Limits>`

- [ ] **Step 1: 타입 정의 작성**

`src/shared/types.ts`:

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
  readonly title: string | null
  /**
   * Post body text. Needed because variable extraction may depend on it, and
   * because collecting it later would mean a second round of requests.
   */
  readonly bodyText: string | null
  readonly authorNickname: string | null
  readonly authorId: string | null
  /** Epoch milliseconds when the source post was written. */
  readonly postedAt: number
}

export interface Template {
  readonly id: string
  readonly body: string
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

`src/shared/ports.ts`:

```ts
export interface TimeParts {
  readonly hour: number
  readonly minute: number
  /** 0 = Sunday, 6 = Saturday. */
  readonly dayOfWeek: number
}

/**
 * All time reading goes through this port so tests can drive the scheduler with
 * a fake calendar instead of waiting for real clocks.
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

`src/shared/profiles.ts`:

```ts
import type { Limits, Profile } from './types.js'

const SECOND = 1_000
const MINUTE = 60_000
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

`tests/shared/profiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROFILES } from '../../src/shared/profiles.js'
import { isUnresolved } from '../../src/shared/types.js'

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
pnpm test
```

Expected: 6 passed (스모크 1 + 신규 5).

- [ ] **Step 6: 배럴 갱신**

`src/shared/index.ts`:

```ts
export * from './types.js'
export * from './ports.js'
export * from './profiles.js'
```

기존 `PROJECT_NAME` export와 `tests/shared/smoke.test.ts`는 삭제한다. 스모크 테스트는 역할을 다했다.

```bash
rm tests/shared/smoke.test.ts
```

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: add domain types, clock/random ports, and profile limits"
```

---

### Task 3: 세션 스케줄러

**Files:**
- Create: `src/shared/schedule.ts`
- Create: `tests/fakes.ts`, `tests/shared/schedule.test.ts`
- Modify: `src/shared/index.ts`

**Interfaces:**
- Consumes: `Clock`, `Random`, `Limits` (Task 2)
- Produces:
  - `isWithinActiveHours(epochMs, limits, clock): boolean`
  - `nextActiveStart(epochMs, limits, clock): number`
  - `nextSessionStart(previousSessionEndMs, limits, clock, random): number`
  - `nextActionDelayMs(limits, random): number`
  - 테스트 픽스처 `FakeClock`, `SequenceRandom` (`tests/fakes.ts`)

- [ ] **Step 1: 테스트 픽스처 작성**

`tests/fakes.ts`:

```ts
import type { Clock, Random, TimeParts } from '../src/shared/ports.js'

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

`tests/shared/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROFILES } from '../../src/shared/profiles.js'
import {
  isWithinActiveHours,
  nextActionDelayMs,
  nextActiveStart,
  nextSessionStart,
} from '../../src/shared/schedule.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

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
    expect(nextActiveStart(MON_03_00, limits, new FakeClock(MON_03_00))).toBe(Date.UTC(2026, 7, 24, 8, 0, 0))
  })

  it('returns tomorrow 08:00 when the window has already closed', () => {
    const after = Date.UTC(2026, 7, 25, 1, 0, 0)
    expect(nextActiveStart(after, limits, new FakeClock(after))).toBe(Date.UTC(2026, 7, 25, 8, 0, 0))
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
    expect(nextActionDelayMs(limits, new SequenceRandom([12_000]))).toBe(12_000)
  })
})
```

- [ ] **Step 3: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import "../../src/shared/schedule.js"`

- [ ] **Step 4: 스케줄러 구현**

`src/shared/schedule.ts`:

```ts
import type { Clock, Random } from './ports.js'
import type { Limits } from './types.js'

const SUNDAY = 0
const SATURDAY = 6

export function isWithinActiveHours(epochMs: number, limits: Limits, clock: Clock): boolean {
  const { hour } = clock.parts(epochMs)
  return hour >= limits.activeHourStart && hour < limits.activeHourEnd
}

/**
 * The next moment the operating window opens. Callers that mean "now" should
 * check `isWithinActiveHours` first; this always returns a future boundary.
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

  return isWithinActiveHours(candidate, limits, clock)
    ? candidate
    : nextActiveStart(candidate, limits, clock)
}

export function nextActionDelayMs(limits: Limits, random: Random): number {
  return random.intInclusive(limits.actionIntervalMinMs, limits.actionIntervalMaxMs)
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 6: 배럴 갱신 후 커밋**

`src/shared/index.ts`에 `export * from './schedule.js'` 추가.

```bash
git add -A
git commit -m "feat: add session scheduler with jitter, active hours, and weekend pacing"
```

---

### Task 4: 총량 게이트와 백로그 브레이크

**Files:**
- Create: `src/shared/limits.ts`
- Create: `tests/shared/limits.test.ts`
- Modify: `src/shared/index.ts`

**Interfaces:**
- Consumes: `Limits`, `GateBlockReason` (Task 2), `Clock` (Task 2)
- Produces:
  - `GateContext { killed, dailyCount, sessionCount }`
  - `GateVerdict = { allowed: true } | { allowed: false; reason: GateBlockReason }`
  - `checkGates(ctx, limits): GateVerdict`
  - `hasStaleBacklog(unresolved: readonly { postedAt: number }[], nowMs, limits): boolean`
  - `dailyWindowStart(epochMs, limits, clock): number`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/shared/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkGates, dailyWindowStart, hasStaleBacklog } from '../../src/shared/limits.js'
import { PROFILES } from '../../src/shared/profiles.js'
import { FakeClock } from '../fakes.js'

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
pnpm test
```

Expected: FAIL — `Failed to resolve import "../../src/shared/limits.js"`

- [ ] **Step 3: 게이트 구현**

`src/shared/limits.ts`:

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
 * normal at a busy board; a backlog holding days-old posts means
 * something is broken.
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
 * 23:00 execution and an 08:00 execution the next morning land on different
 * days the way an operator would expect.
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
pnpm test
```

Expected: 모든 테스트 PASS.

- [ ] **Step 5: 배럴 갱신 후 커밋**

`src/shared/index.ts`에 `export * from './limits.js'` 추가.

```bash
git add -A
git commit -m "feat: add volume gates and age-based backlog brake"
```

---

### Task 5: Guard 평가와 승인 정책

**Files:**
- Create: `src/shared/guards.ts`, `src/shared/policy.ts`
- Create: `tests/shared/guards.test.ts`, `tests/shared/policy.test.ts`
- Modify: `src/shared/index.ts`

**Interfaces:**
- Consumes: `Candidate`, `RiskFlag`, `SkipReason`, `ApprovalPolicy` (Task 2)
- Produces:
  - `GuardOutcome`, `GuardContext`, `Guard`, `GuardEvaluation`
  - `evaluateGuards(guards, candidate, ctx): GuardEvaluation`
  - `operatorAlreadyCommentedGuard: Guard`
  - `Disposition = { kind: 'EXECUTE' } | { kind: 'APPROVE_FIRST' } | { kind: 'SKIP'; reason: SkipReason }`
  - `decide(policy, evaluation): Disposition`

- [ ] **Step 1: guards 실패 테스트 작성**

`tests/shared/guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Guard, GuardContext } from '../../src/shared/guards.js'
import { evaluateGuards, operatorAlreadyCommentedGuard } from '../../src/shared/guards.js'
import type { Candidate } from '../../src/shared/types.js'

const candidate: Candidate = {
  automationId: 'welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  postId: '1001',
  title: '가입인사 드립니다',
  bodyText: '안녕하세요, 위스키 좋아합니다.',
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
    expect(operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: ['cafe-ops'] }))).toEqual({
      kind: 'SKIP',
      reason: 'ALREADY_COMMENTED',
    })
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
    expect(operatorAlreadyCommentedGuard(candidate, ctx({ existingCommentAuthors: null }))).toEqual({
      kind: 'RISK',
      flag: 'COMMENT_CHECK_FAILED',
    })
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

`tests/shared/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decide } from '../../src/shared/policy.js'

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
pnpm test
```

Expected: FAIL — `Failed to resolve import "../../src/shared/guards.js"`

- [ ] **Step 4: guards 구현**

`src/shared/guards.ts`:

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
 * Checking only the executing account double-comments during parallel operation
 * with humans, which is exactly what the Phase 5 ramp-up looks like.
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

`src/shared/policy.ts`:

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

- [ ] **Step 6: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

Expected: 모든 테스트 PASS.

`src/shared/index.ts`에 `export * from './guards.js'`, `export * from './policy.js'` 추가.

```bash
git add -A
git commit -m "feat: add guard evaluation and approval policy resolution"
```

---

### Task 6: 상태 기계

**Files:**
- Create: `src/shared/statusMachine.ts`
- Create: `tests/shared/statusMachine.test.ts`
- Modify: `src/shared/index.ts`

**Interfaces:**
- Consumes: `ExecutionStatus`, `Limits` (Task 2), `Disposition` (Task 5)
- Produces: `StatusEvent`, `InvalidTransitionError`, `initialStatus(disposition)`, `transition(current, event, limits)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/shared/statusMachine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InvalidTransitionError, initialStatus, transition } from '../../src/shared/statusMachine.js'

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
pnpm test
```

Expected: FAIL — `Failed to resolve import "../../src/shared/statusMachine.js"`

- [ ] **Step 3: 상태 기계 구현**

`src/shared/statusMachine.ts`:

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
  if (
    event.type === 'KILLED' &&
    (current === 'AWAITING_APPROVAL' || current === 'QUEUED' || current === 'RETRY_WAIT')
  ) {
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

- [ ] **Step 4: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

Expected: 모든 테스트 PASS.

`src/shared/index.ts`에 `export * from './statusMachine.js'` 추가.

```bash
git add -A
git commit -m "feat: add execution status machine with retry and kill transitions"
```

---

### Task 7: 앱↔확장 프로토콜

**Files:**
- Create: `src/shared/protocol.ts`
- Create: `tests/shared/protocol.test.ts`
- Modify: `src/shared/index.ts`

**Interfaces:**
- Consumes: `ExecutionStrategy` (Task 2)
- Produces:
  - `PROTOCOL_VERSION`, `TIMEOUTS`
  - `SourceRef`, `RawCandidate`, `ActionEnvelope`
  - `AppMessage`, `ExtensionMessage`
  - `isAppMessage(value)`, `isExtensionMessage(value)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/shared/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, TIMEOUTS, isAppMessage, isExtensionMessage } from '../../src/shared/protocol.js'

describe('protocol version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true)
    expect(PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})

describe('timeouts', () => {
  it('keeps every fetch-bearing timeout under the MV3 service worker limit', () => {
    // A service worker is torn down when a fetch takes longer than 30s.
    expect(TIMEOUTS.loginCheckMs).toBeLessThan(30_000)
    expect(TIMEOUTS.collectMs).toBeLessThan(30_000)
    expect(TIMEOUTS.executeMs).toBeLessThan(30_000)
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
        automationId: 'welcome-comment',
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

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import "../../src/shared/protocol.js"`

- [ ] **Step 3: 프로토콜 구현**

`src/shared/protocol.ts`:

```ts
import type { ExecutionStrategy } from './types.js'

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
  readonly title: string | null
  readonly bodyText: string | null
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
      strategy: ExecutionStrategy | null
      commentAuthors: string[] | null
      error: string | null
    }
  | { type: 'ERROR'; requestId: string | null; code: string; message: string }

const APP_MESSAGE_TYPES = new Set<string>(['HELLO_ACK', 'CHECK_LOGIN', 'COLLECT', 'EXECUTE', 'ABORT'])
const EXTENSION_MESSAGE_TYPES = new Set<string>(['HELLO', 'LOGIN_STATE', 'COLLECTED', 'EXECUTED', 'ERROR'])

function messageType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

export function isAppMessage(value: unknown): value is AppMessage {
  const type = messageType(value)
  return type !== null && APP_MESSAGE_TYPES.has(type)
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  const type = messageType(value)
  return type !== null && EXTENSION_MESSAGE_TYPES.has(type)
}
```

- [ ] **Step 4: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

Expected: 모든 테스트 PASS.

`src/shared/index.ts`에 `export * from './protocol.js'` 추가.

```bash
git add -A
git commit -m "feat: define app-extension message contract and timeout budget"
```

---

### Task 8: DB 스키마와 클라이언트

**Files:**
- Create: `drizzle.config.ts`, `src/desktop/db/schema.ts`, `src/desktop/db/client.ts`
- Modify: `package.json` (의존성, `db:generate` 스크립트)
- Test: `tests/desktop/db/client.test.ts`

**Interfaces:**
- Consumes: `ExecutionStatus`, `ExecutionStrategy` (Task 2)
- Produces: 테이블 `executions`, `templates`, `automationSettings`, `watermarks`, `appSettings`, `openDatabase(filePath, options): AppDatabase`, `type AppDatabase`

- [ ] **Step 1: 의존성 추가**

```bash
pnpm add better-sqlite3 drizzle-orm ws
pnpm add -D @types/better-sqlite3 @types/ws drizzle-kit
```

`package.json`의 `scripts`에 추가:

```json
"db:generate": "drizzle-kit generate"
```

- [ ] **Step 2: drizzle 설정 작성**

`drizzle.config.ts`:

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/desktop/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config
```

- [ ] **Step 3: 스키마 작성**

`src/desktop/db/schema.ts`:

```ts
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { ExecutionStatus, ExecutionStrategy } from '../../shared/types.js'

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
    targetTitle: text('target_title'),
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
    executedAt: integer('executed_at'),
    resolvedAt: integer('resolved_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    // cafe_id belongs in the key: post ids are numbered per cafe, so without it
    // cafe A's post 1001 and cafe B's post 1001 collide.
    uniqueIndex('executions_cafe_automation_post_unique').on(
      table.cafeId,
      table.automationId,
      table.targetPostId,
    ),
  ],
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
    cafeId: text('cafe_id').notNull(),
    boardId: text('board_id').notNull(),
    lastSeenPostId: text('last_seen_post_id').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('watermarks_cafe_automation_board_unique').on(
      table.cafeId,
      table.automationId,
      table.boardId,
    ),
  ],
)

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
```

> drizzle-kit이 세 번째 인자의 배열 반환을 문제 삼으면 객체 형태(`(table) => ({ postUnique: uniqueIndex(...) })`)로 바꾼다. 권장 형태가 버전에 따라 다르다.

- [ ] **Step 4: DB 클라이언트 작성**

`src/desktop/db/client.ts`:

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

- [ ] **Step 5: 마이그레이션 생성**

```bash
pnpm db:generate
```

Expected: `drizzle/` 아래에 `.sql` 마이그레이션과 `meta/`가 생성된다.

- [ ] **Step 6: 실패하는 테스트 작성**

`tests/desktop/db/client.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { executions } from '../../../src/desktop/db/schema.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

const row = {
  id: 'e1',
  automationId: 'welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  targetPostId: '1001',
  targetTitle: null,
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
  executedAt: null,
  resolvedAt: null,
  deletedAt: null,
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-db-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDatabase', () => {
  it('creates the executions table via migrations', () => {
    expect(db.select().from(executions).all()).toEqual([])
  })

  it('enforces one row per cafe, automation and post', () => {
    db.insert(executions).values(row).run()
    expect(() => db.insert(executions).values({ ...row, id: 'e2' }).run()).toThrow(/UNIQUE/i)
  })

  it('treats the same post id in a different cafe as a separate row', () => {
    db.insert(executions).values(row).run()
    db.insert(executions).values({ ...row, id: 'e3', cafeId: '99999999' }).run()
    expect(db.select().from(executions).all()).toHaveLength(2)
  })
})
```

- [ ] **Step 7: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

Expected: 3 passed. 실패하면 Step 5의 마이그레이션이 생성되지 않은 것이다.

```bash
git add -A
git commit -m "feat: add sqlite schema and migrated database client"
```

---

### Task 9: DedupeStore — 원자적 선점

**Files:**
- Create: `src/desktop/db/dedupeStore.ts`
- Test: `tests/desktop/db/dedupeStore.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (Task 8)
- Produces: `ClaimInput`, `DedupeStore { claim(input): Promise<string | null> }`, `createSqliteDedupeStore(db, newId)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/desktop/db/dedupeStore.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createSqliteDedupeStore, type ClaimInput } from '../../../src/desktop/db/dedupeStore.js'
import { executions } from '../../../src/desktop/db/schema.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))

let dir: string
let db: AppDatabase

const input: ClaimInput = {
  automationId: 'welcome-comment',
  cafeId: '10000000',
  boardId: '5',
  postId: '1001',
  title: '가입인사',
  authorNickname: '신입회원',
  authorId: 'member-1',
  postedAt: 1_700_000_000_000,
  detectedAt: 1_700_000_100_000,
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-dedupe-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function store() {
  let counter = 0
  return createSqliteDedupeStore(db, () => `id-${++counter}`)
}

describe('createSqliteDedupeStore', () => {
  it('claims an unseen post and returns its execution id', async () => {
    await expect(store().claim(input)).resolves.toBe('id-1')

    const rows = db.select().from(executions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('AWAITING_APPROVAL')
    expect(rows[0]?.attempts).toBe(0)
  })

  it('returns null for a post already claimed', async () => {
    const s = store()
    await s.claim(input)
    await expect(s.claim(input)).resolves.toBeNull()
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('lets exactly one of many concurrent claims win', async () => {
    const s = store()
    const results = await Promise.all(Array.from({ length: 10 }, () => s.claim(input)))
    expect(results.filter((r) => r !== null)).toHaveLength(1)
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('treats the same post id in a different cafe as a separate claim', async () => {
    const s = store()
    await s.claim(input)
    await expect(s.claim({ ...input, cafeId: '99999999' })).resolves.not.toBeNull()
    expect(db.select().from(executions).all()).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import ".../dedupeStore.js"`

- [ ] **Step 3: DedupeStore 구현**

`src/desktop/db/dedupeStore.ts`:

```ts
import type { AppDatabase } from './client.js'
import { executions } from './schema.js'

export interface ClaimInput {
  readonly automationId: string
  readonly cafeId: string
  readonly boardId: string
  readonly postId: string
  readonly title: string | null
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
            targetTitle: input.title,
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
            executedAt: null,
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

- [ ] **Step 4: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

```bash
git add -A
git commit -m "feat: add atomic dedupe store backed by unique constraint"
```

---

### Task 10: executions 리포지토리

**Files:**
- Create: `src/desktop/db/executionsRepo.ts`
- Test: `tests/desktop/db/executionsRepo.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (Task 8), `UNRESOLVED_STATUSES`, `ExecutionStatus`, `ExecutionStrategy`, `RiskFlag` (Task 2)
- Produces: `ExecutionPatch`, `ExecutionRow`, `UnresolvedRow`, `ExecutionsRepo`, `createExecutionsRepo(db)`
  - `applyPatch(id, patch)`, `countSuccessSince(automationId, sinceMs)`, `listUnresolved(automationId)`, `getById(id)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/desktop/db/executionsRepo.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../../src/desktop/db/executionsRepo.js'

const MIGRATIONS = fileURLToPath(new URL('../../../drizzle', import.meta.url))
const AUTOMATION = 'welcome-comment'

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
    title: null,
    authorNickname: 'nick',
    authorId: 'member',
    postedAt,
    detectedAt: postedAt + 1000,
  })
  if (id === null) throw new Error('claim failed in fixture')
  return id
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-repo-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  counter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('applyPatch', () => {
  it('writes status, strategy, timestamps and risk flags', async () => {
    const id = await claim('1001', 1_000)
    repo.applyPatch(id, {
      status: 'SUCCESS',
      strategy: 'FETCH',
      riskFlags: [],
      executedAt: 1_900,
      resolvedAt: 2_000,
    })

    const found = repo.getById(id)
    expect(found?.status).toBe('SUCCESS')
    expect(found?.strategy).toBe('FETCH')
    expect(found?.executedAt).toBe(1_900)
    expect(found?.resolvedAt).toBe(2_000)
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
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import ".../executionsRepo.js"`

- [ ] **Step 3: 리포지토리 구현**

`src/desktop/db/executionsRepo.ts`:

```ts
import { and, eq, gte, inArray } from 'drizzle-orm'
import {
  UNRESOLVED_STATUSES,
  type ExecutionStatus,
  type ExecutionStrategy,
  type RiskFlag,
} from '../../shared/types.js'
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
  readonly executedAt?: number | null
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
  readonly executedAt: number | null
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
      if (patch.executedAt !== undefined) values.executedAt = patch.executedAt
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
        .where(
          and(eq(executions.automationId, automationId), inArray(executions.status, [...UNRESOLVED_STATUSES])),
        )
        .all()
        .map((r) => ({
          id: r.id,
          targetPostId: r.targetPostId,
          targetPostedAt: r.targetPostedAt,
          status: r.status,
          attempts: r.attempts,
        }))
    },

    getById(id) {
      const r = db.select().from(executions).where(eq(executions.id, id)).get()
      if (r === undefined) return undefined
      return {
        id: r.id,
        automationId: r.automationId,
        targetPostId: r.targetPostId,
        targetPostedAt: r.targetPostedAt,
        status: r.status,
        strategy: r.strategy,
        reason: r.reason,
        riskFlags: parseFlags(r.riskFlags),
        attempts: r.attempts,
        executedAt: r.executedAt,
        resolvedAt: r.resolvedAt,
      }
    },
  }
}
```

- [ ] **Step 4: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

```bash
git add -A
git commit -m "feat: add executions repository with status patching and queries"
```

---

### Task 11: 페어링과 WebSocket 브리지

**Files:**
- Create: `src/desktop/ws/pairing.ts`, `src/desktop/ws/server.ts`
- Test: `tests/desktop/ws/pairing.test.ts`, `tests/desktop/ws/server.test.ts`

**Interfaces:**
- Consumes: `AppMessage`, `ExtensionMessage`, `PROTOCOL_VERSION`, `isExtensionMessage` (Task 7)
- Produces:
  - `PairingState`, `HelloAttempt`, `PairingVerdict`, `generateToken()`, `extensionIdFromOrigin(origin)`, `verifyHello(state, attempt)`
  - `ExtensionTransport { isConnected(): boolean; request(message, timeoutMs): Promise<ExtensionMessage> }`
  - `BridgeServer extends ExtensionTransport { port: number; close(): Promise<void> }`, `createBridgeServer(options)`

- [ ] **Step 1: pairing 실패 테스트 작성**

`tests/desktop/ws/pairing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../../../src/shared/protocol.js'
import { extensionIdFromOrigin, generateToken, verifyHello } from '../../../src/desktop/ws/pairing.js'

const TOKEN = 'correct-horse-battery-staple'
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ORIGIN = `chrome-extension://${EXT_ID}`

function attempt(overrides: Partial<Parameters<typeof verifyHello>[1]> = {}) {
  return { token: TOKEN, origin: ORIGIN, protocolVersion: PROTOCOL_VERSION, ...overrides }
}

describe('generateToken', () => {
  it('produces a long, url-safe, non-repeating token', () => {
    const a = generateToken()
    expect(a).not.toBe(generateToken())
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
    expect(verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ origin: 'https://evil.example' }))).toEqual(
      { accepted: false, reason: 'BAD_ORIGIN' },
    )
  })

  it('rejects a mismatched protocol version', () => {
    expect(
      verifyHello({ token: TOKEN, boundExtensionId: null }, attempt({ protocolVersion: PROTOCOL_VERSION + 1 })),
    ).toEqual({ accepted: false, reason: 'PROTOCOL_MISMATCH' })
  })
})
```

- [ ] **Step 2: pairing 구현**

`src/desktop/ws/pairing.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { PROTOCOL_VERSION } from '../../shared/protocol.js'

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
 * Trust on first use: the first extension presenting the correct token is
 * remembered, and only that extension is accepted afterwards. This removes the
 * need to know the extension id before the web store assigns one.
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

- [ ] **Step 3: 서버 실패 테스트 작성**

`tests/desktop/ws/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { generateToken } from '../../../src/desktop/ws/pairing.js'
import { createBridgeServer, type BridgeServer } from '../../../src/desktop/ws/server.js'
import { PROTOCOL_VERSION, type ExtensionMessage } from '../../../src/shared/protocol.js'

const TOKEN = generateToken()
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

let server: BridgeServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function connect(token: string): Promise<WebSocket> {
  if (server === undefined) throw new Error('server not started')
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, { origin: ORIGIN })
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
    const ws = await connect(TOKEN)

    expect(await nextMessage(ws)).toEqual({ type: 'HELLO_ACK', accepted: true, reason: null })
    expect(server.isConnected()).toBe(true)
    ws.close()
  })

  it('rejects a bad token and reports not connected', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect('wrong-token')

    const ack = await nextMessage(ws)
    expect(ack.accepted).toBe(false)
    expect(ack.reason).toBe('BAD_TOKEN')
    expect(server.isConnected()).toBe(false)
  })

  it('round-trips a request and its reply', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
    await nextMessage(ws)

    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string; requestId?: string }
      if (msg.type === 'CHECK_LOGIN' && msg.requestId !== undefined) {
        ws.send(JSON.stringify({ type: 'LOGIN_STATE', requestId: msg.requestId, loggedIn: true, account: 'cafe-ops' }))
      }
    })

    const reply = (await server.request({ type: 'CHECK_LOGIN', requestId: 'r1' }, 1_000)) as Extract<
      ExtensionMessage,
      { type: 'LOGIN_STATE' }
    >

    expect(reply.loggedIn).toBe(true)
    expect(reply.account).toBe('cafe-ops')
    ws.close()
  })

  it('rejects a request that gets no reply before the timeout', async () => {
    server = await createBridgeServer({ token: TOKEN, boundExtensionId: null })
    const ws = await connect(TOKEN)
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

- [ ] **Step 4: 서버 구현**

`src/desktop/ws/server.ts`:

```ts
import { WebSocketServer, type WebSocket } from 'ws'
import { isExtensionMessage, type AppMessage, type ExtensionMessage } from '../../shared/protocol.js'
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

      // Every reply but HELLO carries a requestId; ERROR may carry null when it
      // is not tied to a specific request, and there is nothing to resolve then.
      const requestId: string | null = parsed.requestId
      if (requestId === null) return

      const waiting = pending.get(requestId)
      if (waiting === undefined) return
      clearTimeout(waiting.timer)
      pending.delete(requestId)
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

- [ ] **Step 5: 테스트 통과 확인 후 커밋**

```bash
pnpm test
```

```bash
git add -A
git commit -m "feat: add websocket bridge with trust-on-first-use pairing"
```

---

### Task 12: 확장 스켈레톤

**Files:**
- Create: `src/extension/manifest.json`, `src/extension/background.ts`, `src/extension/stub.ts`, `vite.config.ts`
- Modify: `package.json` (`@types/chrome`, `build:extension` 스크립트)
- Test: `tests/extension/manifest.test.ts`

**Interfaces:**
- Consumes: `AppMessage`, `ExtensionMessage`, `PROTOCOL_VERSION`, `RawCandidate`, `isAppMessage` (Task 7)
- Produces: `dist/extension/background.js`와 `dist/extension/manifest.json`

- [ ] **Step 1: 의존성과 스크립트 추가**

```bash
pnpm add -D @types/chrome
```

`package.json`의 `scripts`에 `"build:extension": "vite build"` 추가.
`tsconfig.json`의 `compilerOptions.types`를 `["node", "chrome"]`로, `lib`를 `["ES2022", "DOM"]`으로 바꾼다.

- [ ] **Step 2: 매니페스트 작성**

`src/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Whisky Manager Bridge",
  "version": "0.0.1",
  "description": "Bridges the cafe automation desktop app to the logged-in browser session.",
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["alarms", "storage"],
  "host_permissions": ["https://cafe.naver.com/*", "https://apis.naver.com/*"]
}
```

> `cookies` 권한은 **절대 추가하지 않는다.** 세션 쿠키를 브라우저 밖으로 내보내지 않는다는 원칙을 코드 수준에서 강제하는 장치이며, Step 5의 테스트가 감시한다.

- [ ] **Step 3: Vite 설정 작성**

`vite.config.ts`:

```ts
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: { background: here('src/extension/background.ts') },
      output: { entryFileNames: '[name].js', format: 'es' },
    },
  },
  plugins: [
    {
      name: 'copy-manifest',
      closeBundle() {
        mkdirSync(here('dist/extension'), { recursive: true })
        copyFileSync(here('src/extension/manifest.json'), here('dist/extension/manifest.json'))
      },
    },
  ],
})
```

- [ ] **Step 4: 스텁과 백그라운드 워커 작성**

`src/extension/stub.ts`:

```ts
import type { RawCandidate } from '../shared/protocol.js'

/**
 * Phase 2 placeholder. Phase 3 replaces this with real collection once the
 * cafe response schema has been observed with a logged-in session. Nothing
 * here talks to naver.
 */
export function stubCandidates(sincePostId: string | null): RawCandidate[] {
  const base = sincePostId === null ? 1000 : Number(sincePostId)
  return [
    {
      postId: String(base + 1),
      title: 'stub greeting',
      bodyText: 'stub body',
      authorNickname: 'stub-member',
      authorId: 'stub-1',
      postedAt: 1_700_000_000_000,
      existingCommentAuthors: [],
    },
  ]
}
```

`src/extension/background.ts`:

```ts
import { PROTOCOL_VERSION, isAppMessage, type AppMessage, type ExtensionMessage } from '../shared/protocol.js'
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

- [ ] **Step 5: 매니페스트 불변식 테스트 작성**

`tests/extension/manifest.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/extension/manifest.json', import.meta.url)), 'utf8'),
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
    expect(manifest.host_permissions).toEqual(['https://cafe.naver.com/*', 'https://apis.naver.com/*'])
  })
})
```

- [ ] **Step 6: 테스트와 빌드 확인 후 커밋**

```bash
pnpm test
pnpm build:extension
```

Expected: 테스트 전부 통과. `dist/extension/`에 `background.js`와 `manifest.json` 생성.

```bash
git add -A
git commit -m "feat: add mv3 extension skeleton with bridge client and reconnect alarm"
```

---

### Task 13: 세션 오케스트레이터 — 왕복 완성

**Files:**
- Create: `src/desktop/orchestrator.ts`
- Test: `tests/desktop/orchestrator.test.ts`

**Interfaces:**
- Consumes: `src/shared` 전체 (Tasks 2~7), `ExtensionTransport` (Task 11), `DedupeStore` (Task 9), `ExecutionsRepo` (Task 10)
- Produces: `SessionDeps`, `SessionRefusal`, `SessionOutcome`, `runSession(deps): Promise<SessionOutcome>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/desktop/orchestrator.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/desktop/db/client.js'
import { createSqliteDedupeStore } from '../../src/desktop/db/dedupeStore.js'
import { createExecutionsRepo, type ExecutionsRepo } from '../../src/desktop/db/executionsRepo.js'
import { executions } from '../../src/desktop/db/schema.js'
import { runSession, type SessionDeps } from '../../src/desktop/orchestrator.js'
import { operatorAlreadyCommentedGuard } from '../../src/shared/guards.js'
import { PROFILES } from '../../src/shared/profiles.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'
import { FakeClock, SequenceRandom } from '../fakes.js'

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url))
const HOUR = 3_600_000
const MON_10_00 = Date.UTC(2026, 7, 24, 10, 0, 0)

interface FakeTransportOptions {
  loggedIn?: boolean
  candidates?: RawCandidate[]
  executeOk?: boolean
}

function fakeTransport(options: FakeTransportOptions = {}) {
  return {
    isConnected: () => true,
    request(message: AppMessage): Promise<ExtensionMessage> {
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
}

function candidate(postId: string, postedAt = MON_10_00 - 60_000): RawCandidate {
  return {
    postId,
    title: '가입인사',
    bodyText: '반갑습니다',
    authorNickname: 'nick',
    authorId: 'm1',
    postedAt,
    existingCommentAuthors: [],
  }
}

let dir: string
let db: AppDatabase
let repo: ExecutionsRepo
let idCounter = 0

function deps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    automationId: 'welcome-comment',
    cafeId: '10000000',
    boardId: '5',
    policy: 'AUTO',
    limits: PROFILES.production,
    guards: [operatorAlreadyCommentedGuard],
    operatorAccounts: ['cafe-ops'],
    clock: new FakeClock(MON_10_00),
    random: new SequenceRandom([10_000]),
    transport: fakeTransport(),
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
  dir = mkdtempSync(join(tmpdir(), 'wm-orch-'))
  db = openDatabase(join(dir, 'test.db'), { migrationsFolder: MIGRATIONS })
  repo = createExecutionsRepo(db)
  idCounter = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runSession — gates before opening', () => {
  it('does not open when the kill switch is engaged', async () => {
    expect(await runSession(deps({ isKilled: () => true }))).toEqual({ opened: false, reason: 'KILLED' })
  })

  it('does not open outside the operating window', async () => {
    const clock = new FakeClock(Date.UTC(2026, 7, 24, 3, 0, 0))
    expect(await runSession(deps({ clock }))).toEqual({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })
  })

  it('does not open when the operator is logged out', async () => {
    const transport = fakeTransport({ loggedIn: false })
    expect(await runSession(deps({ transport }))).toEqual({ opened: false, reason: 'NOT_LOGGED_IN' })
  })

  it('does not open when the login check itself fails', async () => {
    const transport = { isConnected: () => true, request: () => Promise.reject(new Error('timed out')) }
    expect(await runSession(deps({ transport }))).toEqual({ opened: false, reason: 'LOGIN_CHECK_FAILED' })
  })
})

describe('runSession — AUTO policy', () => {
  it('executes clean candidates and records success', async () => {
    const transport = fakeTransport({ candidates: [candidate('1001'), candidate('1002')] })
    const outcome = await runSession(deps({ transport }))

    expect(outcome).toMatchObject({ opened: true, executed: 2, skipped: 0, awaitingApproval: 0, failed: 0 })
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(0)
  })

  it('records the execution timestamp separately from resolution', async () => {
    const transport = fakeTransport({ candidates: [candidate('1010')] })
    await runSession(deps({ transport }))

    const rows = db.select().from(executions).all()
    expect(rows[0]?.executedAt).toBe(MON_10_00)
  })

  it('skips a post an operator already greeted', async () => {
    const already = { ...candidate('1003'), existingCommentAuthors: ['cafe-ops'] }
    const transport = fakeTransport({ candidates: [already] })

    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 0, skipped: 1 })
  })

  it('skips rather than queues when the comment check failed', async () => {
    const unchecked = { ...candidate('1004'), existingCommentAuthors: null }
    const transport = fakeTransport({ candidates: [unchecked] })

    expect(await runSession(deps({ transport }))).toMatchObject({
      opened: true,
      executed: 0,
      skipped: 1,
      awaitingApproval: 0,
    })
  })
})

describe('runSession — SEMI and MANUAL policies', () => {
  it('queues a flagged candidate for approval under SEMI', async () => {
    const unchecked = { ...candidate('1005'), existingCommentAuthors: null }
    const transport = fakeTransport({ candidates: [unchecked] })

    expect(await runSession(deps({ transport, policy: 'SEMI' }))).toMatchObject({
      opened: true,
      executed: 0,
      awaitingApproval: 1,
    })
  })

  it('queues every candidate for approval under MANUAL', async () => {
    const transport = fakeTransport({ candidates: [candidate('1006')] })

    expect(await runSession(deps({ transport, policy: 'MANUAL' }))).toMatchObject({
      opened: true,
      executed: 0,
      awaitingApproval: 1,
    })
  })
})

describe('runSession — caps and failures', () => {
  it('stops at the per-session cap and leaves the current one queued', async () => {
    const many = Array.from({ length: 4 }, (_, i) => candidate(`20${i}`))
    const transport = fakeTransport({ candidates: many })
    const limits = { ...PROFILES.production, perSessionCap: 2 }

    expect(await runSession(deps({ transport, limits }))).toMatchObject({ opened: true, executed: 2 })
    // The candidate that hit the cap stays QUEUED; the ones after it are never
    // claimed at all and will simply be collected again next session.
    expect(repo.listUnresolved('welcome-comment')).toHaveLength(1)
  })

  it('expires candidates once the daily cap is reached', async () => {
    const transport = fakeTransport({ candidates: [candidate('3001')] })
    const limits = { ...PROFILES.production, dailyCap: 0 }

    expect(await runSession(deps({ transport, limits }))).toMatchObject({ opened: true, executed: 0, expired: 1 })
  })

  it('parks a failed execution in RETRY_WAIT rather than failing outright', async () => {
    const transport = fakeTransport({ candidates: [candidate('4001')], executeOk: false })

    expect(await runSession(deps({ transport }))).toMatchObject({ opened: true, executed: 0, failed: 0 })

    const unresolved = repo.listUnresolved('welcome-comment')
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]?.status).toBe('RETRY_WAIT')
    expect(unresolved[0]?.attempts).toBe(1)
  })

  it('does not open when unresolved work has grown stale', async () => {
    const first = fakeTransport({ candidates: [candidate('5001', MON_10_00 - 30 * HOUR)], executeOk: false })
    await runSession(deps({ transport: first }))

    const second = fakeTransport({ candidates: [] })
    expect(await runSession(deps({ transport: second }))).toEqual({ opened: false, reason: 'STALE_BACKLOG' })
  })
})

describe('runSession — dedupe', () => {
  it('ignores a post that was already claimed in an earlier session', async () => {
    await runSession(deps({ transport: fakeTransport({ candidates: [candidate('6001')] }) }))

    const outcome = await runSession(deps({ transport: fakeTransport({ candidates: [candidate('6001')] }) }))
    expect(outcome).toMatchObject({ opened: true, executed: 0, skipped: 0 })
  })
})
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

```bash
pnpm test
```

Expected: FAIL — `Failed to resolve import ".../orchestrator.js"`

- [ ] **Step 3: 오케스트레이터 구현**

`src/desktop/orchestrator.ts`:

```ts
import { evaluateGuards, type Guard } from '../shared/guards.js'
import { checkGates, dailyWindowStart, hasStaleBacklog } from '../shared/limits.js'
import type { Clock, Random } from '../shared/ports.js'
import { decide } from '../shared/policy.js'
import { TIMEOUTS, type ExtensionMessage, type RawCandidate } from '../shared/protocol.js'
import { isWithinActiveHours, nextActionDelayMs } from '../shared/schedule.js'
import { initialStatus, transition } from '../shared/statusMachine.js'
import type { ApprovalPolicy, Candidate, Limits } from '../shared/types.js'
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
      title: raw.title,
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
      title: raw.title,
      bodyText: raw.bodyText,
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

    const gate = checkGates({ killed: deps.isKilled(), dailyCount, sessionCount: executed }, deps.limits)
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
    const startedAt = deps.clock.now()
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
        executedAt: startedAt,
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
      executedAt: startedAt,
      resolvedAt: nextStatus === 'FAILED' ? finishedAt : null,
    })
    if (nextStatus === 'FAILED') failed += 1
  }

  return { opened: true, executed, skipped, awaitingApproval, failed, expired }
}
```

- [ ] **Step 4: 전체 파이프라인 확인 후 커밋**

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build && pnpm build:extension
```

Expected: 전부 exit 0. `src/shared` 커버리지 80% 이상.

```bash
git add -A
git commit -m "feat: add session orchestrator wiring policy, gates, and execution"
```

---

## 이 계획이 끝나면 확보되는 것

- 순수 함수로 구현되고 전부 단위 테스트된 판단 계층 — 스케줄, 총량 게이트, guard, 승인 정책, 상태 기계
- 원자적 선점과 상태 전이가 동작하는 SQLite 저장소. 선점 키에 `cafe_id` 포함
- TOFU 페어링이 걸린 앱↔확장 WebSocket 브리지
- `cookies` 권한이 없음을 테스트로 강제하는 MV3 확장 스켈레톤
- 스텁 확장을 상대로 세션 한 바퀴가 실제로 도는 오케스트레이터

## 이 계획이 다루지 않는 것

- **네이버 실제 엔드포인트와 파서** — 후속 계획 B. 운영 계정으로 로그인한 크롬의 DevTools Network에서 요청·응답을 관찰해 스키마를 확정한 뒤에 작성한다. 관찰 없이 쓰면 추측 구현이 된다
- **Electron 셸, 트레이, 렌더러 UI, 승인 큐 화면, 템플릿 편집, 긴급 회수 UI** — 후속 계획 C
- **워터마크 갱신과 재시도 스케줄링의 영속화** — 계획 C에서 세션 루프를 Electron 메인에 붙일 때 함께 구현한다. 이 계획의 `runSession`은 워터마크를 입력으로만 받는다
- **`Automation` 플러그인 인터페이스** — 2번째 자동화가 생길 때
- **온라인 DB 동기화와 통계 대시보드** — 스펙 12절, 별도 스펙
