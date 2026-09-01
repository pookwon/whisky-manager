# 날 정산 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마감 런을 자정 직전에서 자정 직후로 옮기고, 세션이 끝난 날을 정산하게 해서 하루의 마지막 글이 유실되지 않게 한다.

**Architecture:** `nextDaySettle`이 자정 뒤 밴드를 돌려주고, 스케줄러는 다음 차례가 정규 세션인지 정산 런인지를 함께 돌려준다. 세션은 하루가 아니라 **날 목록**을 작업한다 — 어제가 미정산이면 어제부터, 그 다음 자기 날. 어디까지 정산했는지는 `app_settings`에 한 칸으로 남는다.

**Tech Stack:** TypeScript, Electron, drizzle-orm + better-sqlite3, vitest

## Global Constraints

- 시각은 언제나 KST. 오프셋은 `KST_OFFSET_MS` (`src/shared/kst.ts`) 하나뿐이고 하루 경계 계산은 `kstDayRange`/`kstDayStartMs`가 갖는다. `getUTCHours()`를 그대로 읽거나 `toLocaleString()`에 시간대를 맡기지 않는다.
- 한국어 전용. 다국어 지원은 요구사항이 아니다. 사용자에게 보이는 문구는 `src/shared/text.ts`에 값 그대로 둔다.
- 코드와 주석은 영어로 쓴다.
- 커밋 메시지에 서명·AI 귀속·이모지를 넣지 않는다. 형식은 `<type>: <description>`.
- 새 동작은 테스트가 먼저 실패하는 것을 확인한 뒤 구현한다.
- 판정 규칙(그 날 글·운영진 안내 댓글 없음·작성자별 최초)은 이 계획에서 바뀌지 않는다.

**설계 문서:** [docs/superpowers/specs/2026-09-02-day-settling-design.md](../specs/2026-09-02-day-settling-design.md)

## 파일 구조

| 파일 | 책임 | 변경 |
| --- | --- | --- |
| `src/shared/daySettling.ts` | 정산 런이 언제 도는지 | `dayClosing.ts`에서 이름을 바꿔 옮기고, 자정 전 → 자정 뒤 밴드 |
| `src/shared/types.ts` | `RunMode`에 `'SETTLE'` | 한 줄 |
| `src/shared/limits.ts` | 세션당 상한이 `SETTLE`에도 걸리게 | 조건 한 줄 |
| `src/shared/profiles.ts` | `backlogMaxAgeMs` 24h → 48h | 한 줄 |
| `src/shared/schedule.ts` | 다음 차례의 **시각과 종류**를 돌려준다 | `nextSessionStart` 반환형 변경 |
| `src/desktop/orchestrator.ts` | 세션이 날 목록을 작업 | 가장 큰 변경. 한 날 작업을 `workDay`로 뽑고 그 위에 루프 |
| `src/desktop/session.ts` | 정산 기록을 저장소에 연결 | `lastSettledDay`/`onDaySettled` 주입 |
| `src/desktop/sessionLoop.ts` | 스케줄이 정한 종류로 세션을 연다 | 호출부 |

---

### Task 1: 정산 시각을 자정 뒤로 옮긴다

`dayClosing.ts`를 `daySettling.ts`로 옮기고, 자정 60초 전 대신 자정 뒤 1~15분 밴드를 돌려준다. 밴드인 이유는 이 코드베이스의 다른 모든 간격과 같다 — 매일 같은 초에 도는 것은 기계의 모양이다.

**Files:**
- Create: `src/shared/daySettling.ts`
- Delete: `src/shared/dayClosing.ts`
- Create: `tests/shared/daySettling.test.ts`
- Delete: `tests/shared/dayClosing.test.ts`

**Interfaces:**
- Consumes: `kstDayRange` from `src/shared/kst.ts`, `Random` from `src/shared/ports.ts`
- Produces: `nextDaySettle(afterMs: number, random: Random): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/daySettling.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextDaySettle } from '../../src/shared/daySettling.js'
import { kstDayRange } from '../../src/shared/kst.js'
import { SequenceRandom } from '../fakes.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

// The KST day 2026-08-24 runs from 2026-08-23 15:00 UTC to 2026-08-24 15:00 UTC.
const DAY_START = Date.UTC(2026, 7, 23, 15, 0)
const DAY_END = Date.UTC(2026, 7, 24, 15, 0)
const MORNING = Date.UTC(2026, 7, 24, 1, 0) // 10:00 KST

function spread(ms: number): SequenceRandom {
  return new SequenceRandom([ms])
}

describe('nextDaySettle', () => {
  it('lands after the KST day it settles has ended', () => {
    // The whole point: a finished day cannot gain another post, so a run that
    // opens after midnight has no tail left to miss.
    const at = nextDaySettle(MORNING, spread(5 * MINUTE))
    expect(at).toBe(DAY_END + 5 * MINUTE)
    expect(at).toBeGreaterThan(DAY_END)
  })

  it('draws the offset from the band rather than landing on the same second', () => {
    expect(nextDaySettle(MORNING, spread(MINUTE))).toBe(DAY_END + MINUTE)
    expect(nextDaySettle(MORNING, spread(15 * MINUTE))).toBe(DAY_END + 15 * MINUTE)
  })

  it('clamps a draw outside the band', () => {
    expect(nextDaySettle(MORNING, spread(0))).toBe(DAY_END + MINUTE)
    expect(nextDaySettle(MORNING, spread(HOUR))).toBe(DAY_END + 15 * MINUTE)
  })

  it('still settles yesterday when the day has only just turned', () => {
    // 00:03 KST, and the run drawn for 00:05 has not fired yet. What is owed is
    // still yesterday, not the day that is three minutes old.
    const justAfterMidnight = DAY_START + 3 * MINUTE
    expect(nextDaySettle(justAfterMidnight, spread(5 * MINUTE))).toBe(DAY_START + 5 * MINUTE)
  })

  it('moves to the next boundary once the settle moment has passed', () => {
    const justAfterSettle = DAY_START + 6 * MINUTE
    expect(nextDaySettle(justAfterSettle, spread(5 * MINUTE))).toBe(DAY_END + 5 * MINUTE)
  })

  it('does not hand back the instant it just ran', () => {
    // Strictly after: the loop asks again the moment a session ends, and an
    // answer equal to now would schedule the run on top of itself.
    const settle = DAY_START + 5 * MINUTE
    expect(nextDaySettle(settle, spread(5 * MINUTE))).toBe(DAY_END + 5 * MINUTE)
  })

  it('reads the boundary in KST rather than the machine calendar', () => {
    // 2026-08-24 16:00 UTC is already 2026-08-25 in KST.
    const at = Date.UTC(2026, 7, 24, 16, 0)
    expect(nextDaySettle(at, spread(5 * MINUTE))).toBe(DAY_END + DAY + 5 * MINUTE)
  })

  it('always lands inside the day after the one it settles', () => {
    for (const drawn of [MINUTE, 5 * MINUTE, 15 * MINUTE]) {
      const at = nextDaySettle(MORNING, spread(drawn))
      const day = kstDayRange(at)
      expect(day.startMs).toBe(DAY_END)
    }
  })
})

```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/daySettling.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/daySettling.js"`

- [ ] **Step 3: 구현한다**

`src/shared/daySettling.ts`:

```ts
import { kstDayRange } from './kst.js'
import type { Random } from './ports.js'

/**
 * How far past midnight the run that settles a day lands.
 *
 * Past it, not before it. A run opened while the day is still running leaves
 * whatever arrives after its collection unanswered, and the next day floors at
 * its own midnight, so nothing looks at those posts again. A finished day
 * cannot gain another post, which is what makes the gap disappear rather than
 * merely narrow.
 *
 * A band rather than a fixed offset, for the reason every interval here is
 * drawn: a run landing on the same second of every night is the shape of a
 * machine. The floor is a minute — far enough inside the new day that a clock
 * nudged backwards between the schedule and the gate cannot land the run in the
 * day it means to settle.
 */
const SETTLE_SPREAD_MIN_MS = 60_000
const SETTLE_SPREAD_MAX_MS = 15 * 60_000

/**
 * The next run that settles a finished day, strictly after `afterMs`.
 *
 * The day is the KST one, the same day collection draws its floor from
 * (`kstDayRange`). Reading the boundary off the machine's calendar instead
 * would let the run fire on one side of midnight while the floor moves on the
 * other, and a run that settles a day it is not collecting settles nothing.
 *
 * Strictly after, because the loop asks again once a session ends: handed back
 * the instant it just ran, the run would schedule itself on top of itself.
 */
export function nextDaySettle(afterMs: number, random: Random): number {
  const spread = random.intInclusive(SETTLE_SPREAD_MIN_MS, SETTLE_SPREAD_MAX_MS)
  const { startMs, endMs } = kstDayRange(afterMs)

  // Yesterday's run, when the day has turned but the run has not fired yet.
  const owed = startMs + spread
  return owed > afterMs ? owed : endMs + spread
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/daySettling.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: 옛 파일을 지운다**

```bash
git rm src/shared/dayClosing.ts tests/shared/dayClosing.test.ts
```

`src/shared/index.ts`가 `dayClosing.js`를 재수출하는지 확인하고, 한다면 `daySettling.js`로 고친다:

Run: `grep -rn "dayClosing" src tests`
Expected: `src/shared/schedule.ts`만 남는다 (Task 4에서 고친다)

- [ ] **Step 6: 커밋**

```bash
git add src/shared/daySettling.ts tests/shared/daySettling.test.ts
git commit -m "feat: settle a day after it has ended, not a minute before"
```

---

### Task 2: 정산 실행 모드를 더한다

`RunMode`에 `'SETTLE'`을 더한다. 운영 시간만 넘기고 상한은 전부 지키는 통로다. `'FORCED'`를 재사용하지 않는 이유는 그것이 여섯 개 게이트를 넘기는 모드이고, 나중에 강제 실행의 성질을 손대는 사람이 정산까지 바꾸고 있다는 사실을 모르게 되기 때문이다.

**Files:**
- Modify: `src/shared/types.ts:39`
- Modify: `src/shared/limits.ts:38`
- Test: `tests/shared/limits.test.ts`

**Interfaces:**
- Produces: `RunMode` gains `'SETTLE'`; `checkGates` applies `perSessionCap` to `'SCHEDULED'` and `'SETTLE'`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/limits.test.ts` 끝에 더한다:

```ts
describe('checkGates in settle mode', () => {
  const limits = PROFILES.production

  it('stops at the hourly cap like a scheduled run', () => {
    const verdict = checkGates(
      { killed: false, hourlyCount: limits.hourlyCap, sessionCount: 0 },
      limits,
      'SETTLE',
    )
    expect(verdict).toEqual({ allowed: false, reason: 'HOURLY_CAP_REACHED' })
  })

  it('stops at the session cap like a scheduled run', () => {
    // Settling yesterday is still this session knocking on the cafe, so the two
    // passes share one session's allowance rather than each getting its own.
    const verdict = checkGates(
      { killed: false, hourlyCount: 0, sessionCount: limits.perSessionCap },
      limits,
      'SETTLE',
    )
    expect(verdict).toEqual({ allowed: false, reason: 'SESSION_CAP_REACHED' })
  })

  it('stops on the kill switch', () => {
    const verdict = checkGates({ killed: true, hourlyCount: 0, sessionCount: 0 }, limits, 'SETTLE')
    expect(verdict).toEqual({ allowed: false, reason: 'KILLED' })
  })

  it('allows a run under both caps', () => {
    const verdict = checkGates({ killed: false, hourlyCount: 0, sessionCount: 0 }, limits, 'SETTLE')
    expect(verdict).toEqual({ allowed: true })
  })
})
```

`tests/shared/limits.test.ts` 맨 위 import에 `PROFILES`와 `checkGates`가 이미 있는지 확인하고, 없으면 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/limits.test.ts`
Expected: FAIL — `'SETTLE'` is not assignable to `RunMode`, 그리고 세션 상한 테스트가 `{ allowed: true }`를 받는다

- [ ] **Step 3: 구현한다**

`src/shared/types.ts:39`:

```ts
export type RunMode = 'SCHEDULED' | 'MANUAL' | 'FORCED' | 'SETTLE'
```

`src/shared/limits.ts:38`, 세션 상한 조건:

```ts
  // Manual and forced runs are an operator clearing a backlog in one sitting.
  // A settle run is not: it is the schedule's own work on a finished day, so it
  // shares the allowance every scheduled session has.
  if ((mode === 'SCHEDULED' || mode === 'SETTLE') && ctx.sessionCount >= limits.perSessionCap) {
    return { allowed: false, reason: 'SESSION_CAP_REACHED' }
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/limits.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/shared/types.ts src/shared/limits.ts tests/shared/limits.test.ts
git commit -m "feat: give the schedule a run mode for settling a finished day"
```

---

### Task 3: 밀린 작업 브레이크의 창을 이틀로 넓힌다

작업 창이 하루에서 이틀로 넓어졌다. 창을 그대로 두면 어제 오전 글이 미해결로 남았을 때 브레이크가 걸려 자동화 전체가 멈춘다. `AUTO` 정책에서는 즉시 해소되므로 지금 터지지 않지만, `MANUAL`로 바꾸는 순간 터지는 종류의 문제다.

**Files:**
- Modify: `src/shared/profiles.ts:18`
- Test: `tests/shared/profiles.test.ts`

**Interfaces:**
- Produces: `PROFILES.production.backlogMaxAgeMs === 48 * 3_600_000` (debug도 같다 — `SHARED`에 있다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/profiles.test.ts`에 더한다:

```ts
it('gives the backlog brake room for the two days a session works', () => {
  // A session settles yesterday before working today, so a post from yesterday
  // morning is a day old by the time today's morning session sees it. A
  // twenty-four hour window would read that as a broken tool and stop.
  for (const profile of Object.values(PROFILES)) {
    expect(profile.backlogMaxAgeMs).toBe(48 * 3_600_000)
  }
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/profiles.test.ts`
Expected: FAIL — `expected 86400000 to be 172800000`

- [ ] **Step 3: 구현한다**

`src/shared/profiles.ts`, `SHARED` 안:

```ts
  // Two days, because that is how much a session works: it settles yesterday
  // before it works today. A day-wide window would read yesterday morning's
  // unresolved post as a sign something is broken and stop the automation.
  backlogMaxAgeMs: 48 * HOUR,
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/profiles.test.ts && pnpm vitest run tests/shared/limits.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/shared/profiles.ts tests/shared/profiles.test.ts
git commit -m "feat: widen the backlog brake to the two days a session works"
```

---

### Task 4: 스케줄이 다음 차례의 종류까지 정한다

`nextSessionStart`가 시각만이 아니라 **정규 세션인지 정산 런인지**를 돌려준다. 클램프도 단순해진다 — 정산이 날 안에 들어가야 한다는 제약이 사라졌으므로 뽑은 시각과 정산 시각 중 이른 쪽이면 된다.

**Files:**
- Modify: `src/shared/schedule.ts:1` (import), `src/shared/schedule.ts:60-108`
- Test: `tests/shared/schedule.test.ts`

**Interfaces:**
- Consumes: `nextDaySettle(afterMs, random)` from Task 1, `RunMode` from Task 2
- Produces:
  ```ts
  export interface NextSession {
    readonly at: number
    readonly mode: 'SCHEDULED' | 'SETTLE'
  }
  export function nextSessionStart(
    previousSessionEndMs: number,
    limits: Limits,
    clock: Clock,
    random: Random,
  ): NextSession
  ```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/shared/schedule.test.ts`의 `describe('nextSessionStart')` 안에서, 마감 런을 다루던 다음 네 개를 지운다: `'closes the day rather than deferring past it'`, `'closes the day when the drawn interval would carry the session past it'`, `'gives way to the closing run rather than start a session it would outlast'`, `'gives every day exactly one closing run, weekends included'`, `'does not repeat a closing run it has just finished'`. 나머지 케이스는 `.at`을 읽도록 고친다 — 예를 들어

```ts
  it('adds a jittered interval inside the configured range', () => {
    const drawn = limits.sessionIntervalMinMs
    const clock = clockAt(MON_10_00)
    const random = new SequenceRandom([drawn])
    expect(nextSessionStart(MON_10_00, limits, clock, random).at).toBe(MON_10_00 + drawn)
  })
```

그리고 파일 맨 위 import를 `nextDaySettle`로 바꾼 뒤, 아래를 더한다:

```ts
describe('nextSessionStart and the settle run', () => {
  it('settles the day at the boundary rather than waiting for the morning', () => {
    // 23:30. The next normal session is tomorrow morning; the run that settles
    // today comes first, a few minutes after midnight.
    const random = new SequenceRandom([HOUR, 5 * 60_000, 5 * 60_000])
    const next = nextSessionStart(MON_23_30, limits, clockAt(MON_23_30), random)
    expect(next.mode).toBe('SETTLE')
    expect(next.at).toBe(kst(25, 0, 5))
  })

  it('leaves a draw inside the day alone', () => {
    const random = new SequenceRandom([limits.sessionIntervalMinMs])
    const next = nextSessionStart(MON_10_00, limits, clockAt(MON_10_00), random)
    expect(next.mode).toBe('SCHEDULED')
    expect(next.at).toBe(MON_10_00 + limits.sessionIntervalMinMs)
  })

  it('does not draw a session that would outlast the day any differently', () => {
    // The old clamp pulled this back to just before midnight so the closing run
    // could still fit. It no longer has to fit: the settle run is after the day
    // ends, and a long session simply delays it.
    const at = kst(24, 22)
    const random = new SequenceRandom([4 * HOUR, 5 * 60_000, 5 * 60_000])
    const next = nextSessionStart(at, limits, clockAt(at), random)
    expect(next.mode).toBe('SETTLE')
    expect(next.at).toBe(kst(25, 0, 5))
  })

  it('goes back to normal sessions once the day is settled', () => {
    // Just after the settle run finished. The next boundary is a whole day
    // away, so the morning session is what comes next.
    const at = kst(25, 0, 20)
    const random = new SequenceRandom([HOUR, 4 * 60_000, 5 * 60_000])
    const next = nextSessionStart(at, limits, clockAt(at), random)
    expect(next.mode).toBe('SCHEDULED')
    expect(next.at).toBe(kst(25, 10, 4))
  })

  it('gives every day exactly one settle run, weekends included', () => {
    // The guarantee run out over a week rather than asserted a case at a time.
    const SESSION_MS = 55 * 60_000
    const drawn = (limits.sessionIntervalMinMs + limits.sessionIntervalMaxMs) / 2
    const dayOf = (epochMs: number): number => kstDayRange(epochMs).startMs

    const settled: number[] = []
    const reached = new Set<number>()
    let previousEnd = MON_10_00
    for (let i = 0; i < 30; i += 1) {
      const next = nextSessionStart(
        previousEnd,
        limits,
        clockAt(previousEnd),
        new SequenceRandom([drawn, 5 * 60_000, 5 * 60_000]),
      )
      reached.add(dayOf(next.at))
      // A settle run belongs to the day before the one it lands in.
      if (next.mode === 'SETTLE') settled.push(dayOf(next.at) - 86_400_000)
      previousEnd = next.at + SESSION_MS
    }

    expect(new Set(settled).size).toBe(settled.length)
    expect(settled.length).toBeGreaterThan(6)
    expect(reached.size).toBeGreaterThan(7)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/shared/schedule.test.ts`
Expected: FAIL — `next.mode is undefined`, `next.at is undefined`

- [ ] **Step 3: 구현한다**

`src/shared/schedule.ts` 맨 위 import:

```ts
import { nextDaySettle } from './daySettling.js'
```

`longestSessionMs`를 지우고 — 더 이상 마감이 날 안에 들어가야 하는 제약이 없다 — `nextSessionStart`를 이렇게 바꾼다:

```ts
export interface NextSession {
  readonly at: number
  readonly mode: 'SCHEDULED' | 'SETTLE'
}

/**
 * When the next session opens, and what kind it is.
 *
 * Two calendars meet here, and they are meant to. The operating window is read
 * through the clock, which keeps the machine's day; the settle run is pinned to
 * the KST day, because that is the day collection floors at. On a machine
 * keeping the cafe's own time — the one this is built for — they are the same
 * day.
 *
 * The earlier of the two wins, and that is the whole rule. A draw landing
 * inside the operating window is an ordinary session; a draw that steps over
 * midnight gives way to the run that settles the day it left behind. Nothing
 * here has to reason about whether a session will still be running at the
 * boundary: a settle run that a long session pushes past is picked up by the
 * next session, which checks what is owed before it works its own day.
 */
export function nextSessionStart(
  previousSessionEndMs: number,
  limits: Limits,
  clock: Clock,
  random: Random,
): NextSession {
  const base = random.intInclusive(limits.sessionIntervalMinMs, limits.sessionIntervalMaxMs)
  const multiplier = isWeekend(previousSessionEndMs, clock) ? limits.weekendIntervalMultiplier : 1
  const candidate = previousSessionEndMs + Math.round(base * multiplier)

  const drawn = isWithinActiveHours(candidate, limits, clock)
    ? candidate
    : nextOpeningStart(candidate, limits, clock, random)

  const settleAt = nextDaySettle(previousSessionEndMs, random)
  return settleAt < drawn ? { at: settleAt, mode: 'SETTLE' } : { at: drawn, mode: 'SCHEDULED' }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/shared/schedule.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/shared/schedule.ts tests/shared/schedule.test.ts
git commit -m "feat: let the schedule say whether the next run settles a day"
```

---

### Task 5: 세션이 날 목록을 작업한다

가장 큰 변경이다. 지금 `runSession`은 하루를 작업한다 — 수집하고, 그 묶음을 걷는다. 그것을 `workDay`로 뽑고, 그 위에 날 목록을 도는 루프를 얹는다.

**정산은 별도 세션이 아니라 한 세션의 첫 패스다.** 여는 검사(전면 정지·꺼짐·문구·로그인)와 백로그 걷기는 한 번만 하고, 그 뒤에 날 목록을 돈다. 세션당 상한은 두 패스가 나눠 쓴다 — `attempted`가 이미 세션 전체를 세고 있으므로 저절로 그렇게 된다.

**Files:**
- Modify: `src/desktop/orchestrator.ts`
- Test: `tests/desktop/orchestrator.test.ts`

**Interfaces:**
- Consumes: `RunMode` `'SETTLE'` (Task 2)
- Produces: `SessionDeps` gains
  ```ts
  /** Midnight KST of the last day fully settled, or null when none has been. */
  readonly lastSettledDay: () => number | null
  /** Records that a finished day has been worked to its end. */
  readonly onDaySettled: (dayStartMs: number) => void
  ```
  and `runSession` works `[어제?, 오늘]` instead of one day.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/desktop/orchestrator.test.ts`의 `deps()` 헬퍼에 두 필드를 더한다 (`runMode: 'SCHEDULED',` 바로 뒤):

```ts
    lastSettledDay: () => null,
    onDaySettled: () => {},
```

그리고 파일 끝에 더한다:

```ts
describe('settling the previous day', () => {
  const DAY = 86_400_000
  const TODAY = kstDayStartMs(MON_10_00)
  const YESTERDAY = TODAY - DAY

  /** Records the floor each COLLECT asked for, in the order they were asked. */
  function collectingTransport(byFloor: Map<number, RawCandidate[]>, asked: number[]) {
    const base = fakeTransport()
    return {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'COLLECT') {
          asked.push(message.sincePostedAt)
          return Promise.resolve({
            type: 'COLLECTED',
            requestId: message.requestId,
            candidates: byFloor.get(message.sincePostedAt) ?? [],
          })
        }
        return base.request(message)
      },
    }
  }

  it('works yesterday before today when yesterday is unsettled', async () => {
    const asked: number[] = []
    const transport = collectingTransport(
      new Map([
        [YESTERDAY, [candidate('9001', YESTERDAY + 23 * HOUR + 55 * 60_000)]],
        [TODAY, [candidate('9002', MON_10_00 - 60_000)]],
      ]),
      asked,
    )

    const outcome = await runSession(deps({ transport, lastSettledDay: () => null }))

    expect(asked).toEqual([YESTERDAY, TODAY])
    expect(outcome).toMatchObject({ opened: true, executed: 2 })
  })

  it('collects once when yesterday is already settled', async () => {
    const asked: number[] = []
    const transport = collectingTransport(new Map([[TODAY, [candidate('9002')]]]), asked)

    await runSession(deps({ transport, lastSettledDay: () => YESTERDAY }))

    expect(asked).toEqual([TODAY])
  })

  it('records the day it settled', async () => {
    const settled: number[] = []
    const transport = collectingTransport(new Map(), [])

    await runSession(
      deps({ transport, lastSettledDay: () => null, onDaySettled: (d) => settled.push(d) }),
    )

    expect(settled).toEqual([YESTERDAY])
  })

  it('does not record a day whose collection failed', async () => {
    // A failed read is not an empty day. Recording it would retire a day nobody
    // ever looked at.
    const settled: number[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'COLLECT') {
          return Promise.resolve({ type: 'ERROR', requestId: message.requestId, reason: 'boom' })
        }
        return fakeTransport().request(message)
      },
    }

    await runSession(
      deps({ transport, lastSettledDay: () => null, onDaySettled: (d) => settled.push(d) }),
    )

    expect(settled).toEqual([])
  })

  it('works today even when settling yesterday failed', async () => {
    let first = true
    const asked: number[] = []
    const transport = {
      isConnected: () => true,
      request(message: AppMessage): Promise<ExtensionMessage> {
        if (message.type === 'COLLECT') {
          asked.push(message.sincePostedAt)
          if (first) {
            first = false
            return Promise.resolve({ type: 'ERROR', requestId: message.requestId, reason: 'boom' })
          }
          return Promise.resolve({
            type: 'COLLECTED',
            requestId: message.requestId,
            candidates: [candidate('9002')],
          })
        }
        return fakeTransport().request(message)
      },
    }

    const outcome = await runSession(deps({ transport, lastSettledDay: () => null }))

    expect(asked).toEqual([YESTERDAY, TODAY])
    expect(outcome).toMatchObject({ opened: true, executed: 1 })
  })

  it('judges each day on its own set', async () => {
    // The same person wrote last thing yesterday and again today. Each post is
    // the earliest that person made in its own day, so each is answered — which
    // is the whole reason the two days are collected separately rather than as
    // one widened window.
    const asked: number[] = []
    const yesterdayPost: RawCandidate = {
      ...candidate('9001', YESTERDAY + 23 * HOUR + 55 * 60_000),
      authorId: 'same-person',
    }
    const todayPost: RawCandidate = {
      ...candidate('9002', MON_10_00 - 60_000),
      authorId: 'same-person',
    }
    const transport = collectingTransport(
      new Map([
        [YESTERDAY, [yesterdayPost]],
        [TODAY, [todayPost]],
      ]),
      asked,
    )

    const outcome = await runSession(deps({ transport, lastSettledDay: () => null }))

    expect(outcome).toMatchObject({ opened: true, executed: 2, skipped: 0 })
  })

  it('costs nothing to walk a day that is already answered', async () => {
    // What makes re-walking a settled day cheap: a finished row is terminal, so
    // the claim turns it away before anything asks the cafe about it.
    const post = candidate('9001', YESTERDAY + 23 * HOUR)
    const transport = collectingTransport(new Map([[YESTERDAY, [post]]]), [])

    await runSession(deps({ transport, lastSettledDay: () => null }))
    const afterFirst = db.select().from(executions).all()
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]?.status).toBe('SUCCESS')

    let asked = 0
    const counting: CommentAuthorLookup = {
      resolve: async () => {
        asked += 1
        return []
      },
    }
    await runSession(
      deps({ transport, lastSettledDay: () => null, commentAuthors: counting }),
    )

    expect(asked).toBe(0)
    expect(db.select().from(executions).all()).toHaveLength(1)
  })

  it('settles only yesterday, never the day before it', async () => {
    const asked: number[] = []
    const transport = collectingTransport(new Map(), asked)

    await runSession(deps({ transport, lastSettledDay: () => YESTERDAY - 5 * DAY }))

    expect(asked).toEqual([YESTERDAY, TODAY])
  })

  it('works only yesterday in settle mode', async () => {
    // The run that fires a few minutes past midnight has nothing to do with the
    // day that is five minutes old. Greeting on an empty board is what the
    // operating window exists to prevent.
    const asked: number[] = []
    const transport = collectingTransport(new Map(), asked)
    const justAfterMidnight = TODAY + 5 * 60_000

    await runSession(
      deps({
        transport,
        runMode: 'SETTLE',
        clock: new FakeClock(justAfterMidnight),
        lastSettledDay: () => null,
      }),
    )

    expect(asked).toEqual([YESTERDAY])
  })

  it('opens outside the operating window in settle mode', async () => {
    const justAfterMidnight = TODAY + 5 * 60_000
    const outcome = await runSession(
      deps({ runMode: 'SETTLE', clock: new FakeClock(justAfterMidnight), lastSettledDay: () => null }),
    )

    expect(outcome.opened).toBe(true)
  })

  it('still refuses a scheduled session outside the operating window', async () => {
    const justAfterMidnight = TODAY + 5 * 60_000
    const outcome = await runSession(deps({ clock: new FakeClock(justAfterMidnight) }))

    expect(outcome).toEqual({ opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' })
  })

  it('works only the day it was told to when an operator names one', async () => {
    // A dated run is the operator naming a day. Settling must not widen it.
    const asked: number[] = []
    const transport = collectingTransport(new Map(), asked)
    const named = YESTERDAY - 3 * DAY

    await runSession(
      deps({ transport, runMode: 'FORCED', dayStartMs: named, lastSettledDay: () => null }),
    )

    expect(asked).toEqual([named])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/orchestrator.test.ts`
Expected: FAIL — `lastSettledDay` does not exist on `SessionDeps`, 그리고 COLLECT가 한 번만 불린다

- [ ] **Step 3: 구현한다**

`src/desktop/orchestrator.ts`. `SessionDeps`에 두 필드를 더한다 (`dayStartMs` 바로 뒤):

```ts
  /**
   * Midnight KST of the last day worked to its end, or null when none has
   * been. Read rather than stored so a session sees what the last one recorded
   * without either of them holding the file open.
   */
  readonly lastSettledDay: () => number | null
  /**
   * Records that a finished day has been worked to its end. Called only for a
   * day the schedule chose, never for one an operator named: a dated run is a
   * person asking about one day, not a claim that the day is now retired.
   */
  readonly onDaySettled: (dayStartMs: number) => void
```

`kstDayStartMs`를 import하고, 날 목록을 정하는 함수를 더한다:

```ts
const MS_PER_DAY = 86_400_000

/**
 * Which days this session works, oldest first.
 *
 * An operator who named a day gets that day and nothing else — widening it
 * would answer a different question than the one asked. Otherwise the session
 * settles yesterday when nobody has, and then works its own day.
 *
 * Only yesterday. A greeting three days late is worse than none, and a week
 * away from the machine should not end with a week of greetings arriving at
 * once. Those days stay the operator's to run by hand, where they see what is
 * about to go out before it does.
 */
function daysToWork(deps: SessionDeps, openedAt: number): number[] {
  if (deps.dayStartMs !== undefined) return [deps.dayStartMs]

  const today = kstDayStartMs(openedAt)
  const yesterday = today - MS_PER_DAY
  const settled = deps.lastSettledDay()
  const owed = settled === null || settled < yesterday

  // A settle run opens minutes past midnight, when its own day holds nothing
  // and the board is empty. It settles what is owed and stops there.
  if (deps.runMode === 'SETTLE') return owed ? [yesterday] : []
  return owed ? [yesterday, today] : [today]
}
```

운영 시간 게이트를 고친다:

```ts
  const openedAt = deps.clock.now()
  // A forced run is an operator who was shown what they were overriding. A
  // settle run is the schedule finishing a day that has already ended, which
  // the window was never drawn to prevent.
  const bypassesWindow = deps.runMode === 'FORCED' || deps.runMode === 'SETTLE'
  if (!bypassesWindow && !isWithinActiveHours(openedAt, deps.limits, deps.clock)) {
    return { opened: false, reason: 'OUTSIDE_ACTIVE_HOURS' }
  }
```

`forced`를 쓰던 나머지 두 곳(`STALE_BACKLOG` 브레이크, 그리고 `runJob`에 넘기는 `runMode`)은 그대로 `deps.runMode === 'FORCED'`를 쓴다 — 정산은 브레이크를 지킨다.

집계를 한 객체로 모은다. 지금은 지역 변수 다섯 개가 `runSession` 안에 흩어져 있는데, 두 날이 그것을 함께 쓰려면 넘길 수 있는 하나여야 한다:

```ts
/**
 * What the session has done so far, across every day it works.
 *
 * One object rather than five counters, because the days share it. The session
 * cap counts `attempted`, so a settle pass that spends the allowance leaves the
 * session's own day with none — which is the intent: it is one session knocking
 * on the cafe, whichever day's post it is knocking about.
 */
interface Tally {
  executed: number
  skipped: number
  awaitingApproval: number
  failed: number
  /** Requests that actually reached naver. Caps count attempts, not successes. */
  attempted: number
}

function record(tally: Tally, result: JobResult): void {
  // EXECUTED, FAILED and RETRY all mean a request reached naver.
  if (result === 'EXECUTED' || result === 'FAILED' || result === 'RETRY') {
    tally.attempted += 1
  }
  if (result === 'EXECUTED') {
    tally.executed += 1
  } else if (result === 'SKIPPED') {
    tally.skipped += 1
  } else if (result === 'FAILED') {
    tally.failed += 1
  }
}

function summarise(tally: Tally): SessionOutcome {
  return {
    opened: true,
    executed: tally.executed,
    skipped: tally.skipped,
    awaitingApproval: tally.awaitingApproval,
    failed: tally.failed,
  }
}
```

수집부터 걷기까지를 함수로 뽑는다. 지금 `runSession` 안의 `deps.onProgress?.({ phase: 'COLLECTING' })`부터 마지막 `tally(result)`까지가 그대로 몸통이 되고, 지역 변수를 읽던 자리가 `tally`의 필드가 된다:

```ts
type DayResult = 'DONE' | 'COLLECT_FAILED' | 'STOP'

/**
 * One day, end to end: collect it, judge every post in it, act on the ones that
 * pass. Separated from the session because a session may work two of them, and
 * both must reach the board through this one door — a second copy of this walk
 * would be a second set of rules nobody remembered to keep in step.
 */
async function workDay(deps: SessionDeps, dayStartMs: number, tally: Tally): Promise<DayResult> {
  // The whole day, every session. A post passed over earlier has to come back
  // into view, because what disqualified it can change on the cafe's side.
  deps.onProgress?.({ phase: 'COLLECTING' })
  const raws = await collectDay({
    transport: deps.transport,
    automationId: deps.automationId,
    source: { cafeId: deps.cafeId, boardId: deps.boardId },
    newRequestId: deps.newRequestId,
    dayStartMs,
    onProgress: (pagesRead, collected) =>
      deps.onProgress?.({ phase: 'COLLECTING', pagesRead, collected }),
  })
  if (raws === null) return 'COLLECT_FAILED'

  // Fixed for this day's walk, and the same context the count shown before this
  // run was reached through. Computed per day rather than once per session, so
  // a person who wrote last thing yesterday and again today is the earliest in
  // each set and is answered in each.
  const screening: ScreeningContext = {
    automationId: deps.automationId,
    source: { cafeId: deps.cafeId, boardId: deps.boardId },
    policy: deps.policy,
    guards: deps.guards,
    operatorAccounts: deps.operatorAccounts,
    firstPosts: firstPostIdByAuthor(raws),
    renderBody: deps.renderBody,
  }

  for (const [index, raw] of raws.entries()) {
    deps.onProgress?.({
      phase: 'WORKING',
      done: index,
      total: raws.length,
      nickname: raw.authorNickname,
    })

    // Ahead of the claim so a post past the cap costs neither a row nor a
    // lookup. runJob checks again for the backlog walk, which does not come
    // through here.
    const gate = checkGates(
      {
        killed: deps.isKilled(),
        hourlyCount: sentWithinTheHour(deps, deps.clock.now()),
        sessionCount: tally.attempted,
      },
      deps.limits,
      deps.runMode,
    )
    if (!gate.allowed) {
      // Out of room, not out of days. Stopping the session rather than this day
      // alone is the same call the single-day walk made: the next day would
      // meet the same closed gate on its first candidate.
      return 'STOP'
    }

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

    const existingCommentAuthors = await deps.commentAuthors.resolve(raw.postId, raw.commentCount)
    const { candidate, evaluation, disposition, rendered } = screenCandidate(raw, screening, {
      nowMs: now,
      existingCommentAuthors,
    })
    const status = initialStatus(disposition)

    if (status === 'SKIPPED') {
      deps.repo.applyPatch(executionId, {
        status,
        reason: disposition.kind === 'SKIP' ? disposition.reason : null,
        riskFlags: evaluation.flags,
        resolvedAt: now,
      })
      tally.skipped += 1
      continue
    }

    if (status === 'AWAITING_APPROVAL') {
      deps.repo.applyPatch(executionId, { status, riskFlags: evaluation.flags })
      tally.awaitingApproval += 1
      continue
    }

    if (!rendered.ok) {
      // decide() must have routed an unrenderable candidate away from QUEUED.
      throw new Error(`cannot execute ${candidate.postId}: missing ${rendered.missing.join(', ')}`)
    }

    // Persist the decision and the text before executing, so a crash leaves a
    // row the next session can pick up from the backlog.
    deps.repo.applyPatch(executionId, {
      status: 'QUEUED',
      riskFlags: evaluation.flags,
      templateId: rendered.templateId,
      renderedText: rendered.body,
    })

    const result = await runJob(
      deps,
      {
        executionId,
        cafeId: candidate.cafeId,
        boardId: candidate.boardId,
        postId: candidate.postId,
        body: rendered.body,
        templateId: rendered.templateId,
        priorAttempts: 0,
      },
      tally.attempted,
    )
    if (result === 'STOP') return 'STOP'
    record(tally, result)
  }

  return 'DONE'
}
```

`runSession` 안에서는 흩어져 있던 다섯 개의 지역 변수와 `tally`/`summary` 클로저를 지우고, 대신 하나를 만든다:

```ts
  const tally: Tally = { executed: 0, skipped: 0, awaitingApproval: 0, failed: 0, attempted: 0 }
```

백로그 걷기의 두 줄이 그에 맞춰 바뀐다 — `attempted` → `tally.attempted`, `tally(result)` → `record(tally, result)`, `return summary()` → `return summarise(tally)`:

```ts
    const result = await runJob(
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
      tally.attempted,
    )
    if (result === 'STOP') return summarise(tally)
    record(tally, result)
  }
```

그리고 백로그 걷기 뒤, 원래 수집이 있던 자리에 루프를 얹는다:

```ts
  const ownDay = kstDayStartMs(openedAt)
  // A day an operator named is theirs, not the schedule's. Recording it as
  // settled would retire a day on the strength of a question someone asked.
  const isNamedDay = deps.dayStartMs !== undefined

  for (const day of daysToWork(deps, openedAt)) {
    const result = await workDay(deps, day, tally)
    if (result === 'STOP') return summarise(tally)
    // A failed read is not an empty day. The day stays owed and the next
    // session tries again — and it must not cost the day this session came for,
    // so the loop carries on either way.
    if (result === 'DONE' && !isNamedDay && day !== ownDay) deps.onDaySettled(day)
  }

  return summarise(tally)
```

**`COLLECT_FAILED` 거절이 사라진다.** 지금은 수집이 실패하면 세션 전체가 `{ opened: false, reason: 'COLLECT_FAILED' }`로 끝나는데, 두 날을 걷는 세션에서는 어제의 실패가 오늘을 막아서는 안 된다. `SessionRefusal`의 `'COLLECT_FAILED'` 항목은 남겨 둔다 — 한 날짜만 걷는 운영자의 날짜 지정 실행에서는 여전히 그 날의 수집 실패가 세션의 결과이기 때문이다:

```ts
  // A named day is the only case where one failed read is the whole session's
  // answer: there is no other day to carry on to.
  if (isNamedDay && result === 'COLLECT_FAILED') return { opened: false, reason: 'COLLECT_FAILED' }
```

이 줄은 위 루프 안, `if (result === 'STOP')` 바로 뒤에 들어간다.

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/orchestrator.test.ts`
Expected: PASS — 기존 테스트를 포함해 전부

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/orchestrator.ts tests/desktop/orchestrator.test.ts
git commit -m "feat: let a session settle yesterday before it works today"
```

---

### Task 6: 어디까지 정산했는지 남긴다

`app_settings`에 한 칸. 세션이 그것을 읽고 쓴다.

**Files:**
- Modify: `src/desktop/session.ts:14-18` (`SETTING_KEYS`), `src/desktop/session.ts:104-133` (`runSession` 호출)
- Test: `tests/desktop/session.test.ts`

**Interfaces:**
- Consumes: `SessionDeps.lastSettledDay` / `onDaySettled` (Task 5), `SettingsRepo` (`get`/`set`)
- Produces: `SETTING_KEYS.lastSettledDay = 'lastSettledDayStartMs'`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/desktop/session.test.ts`에 더한다. 기존 파일의 세션 조립 헬퍼를 그대로 쓴다:

```ts
describe('the settled-day record', () => {
  it('reads nothing when the setting has never been written', async () => {
    // A fresh install has settled no days. Reading it as day zero would make
    // every day since the epoch look owed.
    settings.remove(SETTING_KEYS.lastSettledDay)
    const run = createSessionRunner(options())
    await run({ mode: 'SCHEDULED' })
    expect(settings.get(SETTING_KEYS.lastSettledDay)).toBeDefined()
  })

  it('writes the day it settled', async () => {
    const run = createSessionRunner(options())
    await run({ mode: 'SCHEDULED' })
    const written = Number(settings.get(SETTING_KEYS.lastSettledDay))
    expect(written).toBe(kstDayStartMs(clock.now()) - 86_400_000)
  })

  it('ignores a value that is not a number', async () => {
    // A hand-edited or half-written setting must not stop the tool; the worst
    // it should cost is one redundant collection.
    settings.set(SETTING_KEYS.lastSettledDay, 'yesterday-ish')
    const run = createSessionRunner(options())
    const outcome = await run({ mode: 'SCHEDULED' })
    expect(outcome.opened).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/session.test.ts`
Expected: FAIL — `SETTING_KEYS.lastSettledDay` is undefined

- [ ] **Step 3: 구현한다**

`src/desktop/session.ts`:

```ts
export const SETTING_KEYS = {
  cafeId: 'cafeId',
  cafeUrlName: 'cafeUrlName',
  operatorAccounts: 'operatorAccounts',
  /** Midnight KST of the last day worked to its end, as a decimal string. */
  lastSettledDay: 'lastSettledDayStartMs',
} as const
```

`runSession` 호출에 두 필드를 더한다:

```ts
      lastSettledDay: () => {
        const raw = settings.get(SETTING_KEYS.lastSettledDay)
        if (raw === undefined) return null
        const parsed = Number(raw)
        // A setting that is not a number is a setting nobody can act on. Reading
        // it as null costs one redundant collection; reading it as NaN would
        // make every comparison against it false and settle nothing, ever.
        return Number.isFinite(parsed) ? parsed : null
      },
      onDaySettled: (dayStartMs) => {
        settings.set(SETTING_KEYS.lastSettledDay, String(dayStartMs))
      },
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/session.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/session.ts tests/desktop/session.test.ts
git commit -m "feat: remember which day was settled last"
```

---

### Task 7: 루프가 스케줄이 정한 종류로 세션을 연다

**Files:**
- Modify: `src/desktop/sessionLoop.ts:130-152`
- Test: `tests/desktop/sessionLoop.test.ts`

**Interfaces:**
- Consumes: `nextSessionStart(...): NextSession` (Task 4)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/desktop/sessionLoop.test.ts`의 상수 옆에 하나를 더한다:

```ts
// Late enough that the next thing the schedule draws is the run which settles
// this day, a few minutes after midnight.
const MON_23_30 = Date.UTC(2026, 7, 24, 23, 30, 0) - KST_OFFSET_MS
```

그리고 `describe('createSessionLoop')` 안에 더한다. 타이머 콜백을 붙잡아 직접 부르는 방식은 이 파일이 이미 쓰는 것이고, `runSession`은 콜백 안에서 동기적으로 불리므로 기다릴 것이 없다:

```ts
  it('opens the run that settles a day in settle mode', () => {
    const seen: (string | undefined)[] = []
    const setTimer = vi.fn((_fn: () => void, _ms: number) => 1)
    const loop = createSessionLoop(
      loopDeps({
        clock: new FakeClock(MON_23_30, KST_OFFSET_MS),
        setTimer,
        runSession: (request) => {
          seen.push(request?.mode)
          return Promise.resolve(idleOutcome)
        },
      }),
    )

    loop.start()
    setTimer.mock.calls[0]?.[0]?.()
    loop.stop()

    expect(seen[0]).toBe('SETTLE')
  })

  it('opens an ordinary session in scheduled mode', () => {
    const seen: (string | undefined)[] = []
    const setTimer = vi.fn((_fn: () => void, _ms: number) => 1)
    const loop = createSessionLoop(
      loopDeps({
        setTimer,
        runSession: (request) => {
          seen.push(request?.mode)
          return Promise.resolve(idleOutcome)
        },
      }),
    )

    loop.start()
    setTimer.mock.calls[0]?.[0]?.()
    loop.stop()

    expect(seen[0]).toBe('SCHEDULED')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run tests/desktop/sessionLoop.test.ts`
Expected: FAIL — `SCHEDULED`가 두 번 다 기록된다

- [ ] **Step 3: 구현한다**

`src/desktop/sessionLoop.ts`의 `schedule()`:

```ts
  function schedule(): void {
    const now = deps.clock.now()
    const next = nextSessionStart(now, deps.limits, deps.clock, deps.random)
    nextScheduledAt = next.at
    timer = deps.setTimer(() => {
      timer = null
      const wake: WakeRecord = { scheduledFor: next.at, wokeAt: deps.clock.now() }
      void runOnceInternal({ mode: next.mode }, wake).finally(() => {
        if (running && timer === null) schedule()
      })
    }, Math.max(0, next.at - now))
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm vitest run tests/desktop/sessionLoop.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/desktop/sessionLoop.ts tests/desktop/sessionLoop.test.ts
git commit -m "feat: open the settle run in the mode the schedule chose"
```

---

### Task 8: 전체를 통과시킨다

**Files:**
- Modify: 타입 오류가 남은 곳

호출부는 미리 확인해 두었다. `SessionDeps`를 조립하는 곳은 `src/desktop/session.ts` 하나뿐이고 Task 6이 이미 채웠다. `src/desktop/preview.ts`는 `SessionDeps`가 아니라 자체 `PreviewDeps`를 쓰므로 손댈 것이 없다. `nextSessionStart`를 부르는 곳은 `src/desktop/sessionLoop.ts` 하나뿐이고 Task 7이 고쳤다. `src/shared/index.ts`는 `dayClosing`을 재수출하지 않는다.

**그러므로 이 Task에서 새로 고칠 것이 없는 것이 정상이다.** 무언가 걸린다면 앞 Task가 덜 끝난 것이다.

- [ ] **Step 1: 타입 검사**

Run: `pnpm typecheck`
Expected: PASS. 실패하면 앞 Task로 돌아간다 — 여기서 임시로 때우지 않는다.

- [ ] **Step 2: 린트**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: 전체 테스트**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 4: 남은 참조 확인**

Run: `grep -rn "dayClosing\|nextDayClosing" src tests docs/superpowers/specs`
Expected: 설계 문서 외에는 없다

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "fix: carry the settle run through the session's callers"
```

---

## 확인

구현이 끝나면 아래를 눈으로 확인한다. 자동 테스트가 답하지 못하는 것들이다.

- `pnpm start`로 띄우면 대시보드의 다음 세션 시각이 자정 직후(00:01~00:15)로 잡히는 밤이 있다 — 23:59가 아니다
- 하루를 지낸 뒤 `app_settings`에 `lastSettledDayStartMs`가 어제 자정으로 남아 있다

```bash
sqlite3 -header -column "file://$HOME/Library/Application Support/whisky-manager/whisky-manager.db?mode=ro" "select key, value, datetime(value/1000,'unixepoch','+9 hours') as kst from app_settings where key = 'lastSettledDayStartMs';"
```
