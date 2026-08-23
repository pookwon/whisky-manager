# 강제 실행과 날짜 지정 실행 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 직접 지시했을 때는 운영 시간과 상한을 넘어 실행할 수 있게 하고, 특정 하루를 골라 그날 몫을 처리할 수 있게 한다.

**Architecture:** 세션에 실행 모드와 대상 날짜를 넣는다. 모드가 어떤 게이트를 넘길지 결정하고, 대상 날짜가 어떤 글을 볼지 결정한다. 판정 규칙 자체는 손대지 않는다.

**Tech Stack:** TypeScript(ESM), Electron 메인/렌더러, Chrome MV3 확장, Drizzle + better-sqlite3, vitest.

## Global Constraints

- 설계는 [강제 실행과 날짜 지정 실행 설계](../specs/2026-08-24-forced-and-dated-runs-design.md)를 따른다. 문서와 코드가 어긋나면 문서를 고치는 것도 작업에 포함된다.
- 코드와 주석은 영어, 사용자 대면 문구는 전부 `src/renderer/locales/ko.ts`.
- 색은 3개 제한, 상태색(ok/warn/alarm)은 문서화된 예외. 라이트/다크 둘 다 동작해야 한다.
- 불변성 기본. TODO 주석·죽은 코드·자리표시자 금지. 주석은 왜인지를 적고 무엇인지는 적지 않는다.
- TypeScript는 `exactOptionalPropertyTypes: true`. 값이 없을 수 있으면 조건부 스프레드를 쓴다(`src/extension/background.ts`의 `withReferer` 참고).
- 각 작업이 끝난 시점에 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:all`이 모두 통과해야 한다. 테스트는 전체 수를 보고한다.
- 커밋 메시지에 AI 귀속(`Co-Authored-By` 등)을 넣지 않는다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/shared/limits.ts` | 게이트가 실행 모드를 본다. 08시 기준 하루 묶기는 사라진다 |
| `src/shared/types.ts` | `RunMode` |
| `src/desktop/db/executionsRepo.ts` | 집계를 글의 날짜로 센다 |
| `src/desktop/orchestrator.ts` | 실행 모드와 대상 날짜 |
| `src/desktop/session.ts` | 모드·날짜를 받아 세션을 조립한다 |
| `src/desktop/sessionLoop.ts` | 수동 실행 중 예약된 차례를 건너뛴다 |
| `src/desktop/ipc.ts`, `rendererApi.ts`, `main.ts`, `bootstrap.ts` | 렌더러가 모드와 날짜를 지시한다 |
| `src/renderer/views/Dashboard.tsx` | 확인 절차와 날짜 선택 |

---

## Task 1: 하루를 글의 날짜로 센다

집계와 상한이 *언제 댓글을 달았는지*가 아니라 *어느 날 글을 처리했는지*를 세게 한다. 이 작업만으로 동작이 바뀌는 곳은 없다 — 정규 동작에서는 두 정의가 같은 답을 내기 때문이다. 지난 날을 처리하는 기능이 붙는 Task 3에서 비로소 차이가 드러난다.

**Files:**
- Modify: `src/desktop/db/executionsRepo.ts`, `src/shared/limits.ts`, `src/desktop/orchestrator.ts`, `src/desktop/rendererApi.ts`
- Test: `tests/desktop/db/executionsRepo.test.ts`, `tests/shared/limits.test.ts`, `tests/desktop/orchestrator.test.ts`, `tests/desktop/rendererApi.test.ts`

**Interfaces:**
- Produces: `countExecutedForDay(automationId, dayStartMs, dayEndMs): number`, `countByStatusForDay(automationId, status, dayStartMs, dayEndMs): number`
- Removes: `countExecutedSince`, `countByStatusSince`, `dailyWindowStart`

- [ ] **Step 1: 집계 테스트를 먼저 쓴다**

`tests/desktop/db/executionsRepo.test.ts`에 더한다. 행 세 개를 만든다 — 오늘 글을 오늘 처리한 것, **지난 날 글을 오늘 처리한 것**, 오늘 글이지만 아직 실행되지 않은 것(`executedAt`이 null).

- 오늘 창으로 세면 1건이다. 지난 날 글을 오늘 처리한 행은 잡히지 않는다
- 그 지난 날의 창으로 세면 그 행이 1건으로 잡힌다
- 실행되지 않은 행은 어느 창에서도 잡히지 않는다

`countByStatusForDay`도 같은 방식으로 `SUCCESS`와 `FAILED`에 대해 덮는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/desktop/db/executionsRepo.test.ts`
Expected: FAIL — 함수가 없다.

- [ ] **Step 3: 저장소를 고친다**

`countExecutedSince`/`countByStatusSince`를 날짜 창을 받는 형태로 바꾼다. 조건은 `executedAt IS NOT NULL`이면서 `targetPostedAt >= dayStartMs AND targetPostedAt < dayEndMs`이다.

주석에 왜 실행 시각이 아니라 글의 시각인지를 한 줄로 남긴다 — 지난 날을 메우는 일이 오늘 몫을 잡아먹지 않아야 하기 때문이다.

- [ ] **Step 4: 호출부를 옮긴다**

`src/desktop/orchestrator.ts`의 `dailyCount`와 `src/desktop/rendererApi.ts`의 대시보드 집계가 새 함수를 쓴다. 창은 `kstDayStartMs`와 그 하루 뒤로 만든다.

`src/shared/limits.ts`의 `dailyWindowStart`는 쓰이는 곳이 없어진다. 함수와 그 테스트를 지운다. `Limits`의 `activeHourStart`는 운영 시간 판정에 여전히 쓰이므로 남긴다.

- [ ] **Step 5: 전체를 확인하고 커밋한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build:all`

```bash
git add -A
git commit -m "refactor: count a day's work by the day of the post"
```

---

## Task 2: 실행 모드

세션이 어떤 게이트를 넘길지를 모드 하나로 정한다.

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/limits.ts`, `src/desktop/orchestrator.ts`, `src/desktop/session.ts`, `src/desktop/sessionLoop.ts`, `src/desktop/bootstrap.ts`
- Test: `tests/shared/limits.test.ts`, `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`, `tests/desktop/sessionLoop.test.ts`

**Interfaces:**
- Produces: `RunMode = 'SCHEDULED' | 'MANUAL' | 'FORCED'`, `SessionDeps.runMode`
- Removes: `SessionDeps.isManualRun`, `checkGates`의 `isManualRun` 인자

- [ ] **Step 1: 게이트 테스트를 먼저 쓴다**

`tests/shared/limits.test.ts`에서 세 모드를 각각 덮는다.

- `SCHEDULED`는 세션당 상한과 하루 상한에 모두 걸린다
- `MANUAL`은 세션당 상한을 넘기고 하루 상한에는 걸린다
- `FORCED`는 둘 다 넘긴다
- **세 모드 모두 전면 정지에는 걸린다**

- [ ] **Step 2: 실패를 확인하고 게이트를 고친다**

`checkGates`가 `isManualRun: boolean` 대신 `RunMode`를 받는다. `RunMode`는 `src/shared/types.ts`에 둔다.

- [ ] **Step 3: 세션이 모드를 본다**

`src/desktop/orchestrator.ts`에서 `isManualRun`을 `runMode`로 바꾸고, `FORCED`일 때 운영 시간 확인과 밀린 작업 브레이크를 건너뛴다. 전면 정지·자동화 꺼짐·문구 없음·로그인 확인은 어떤 모드에서도 그대로다.

**한 건 사이의 전면 정지 확인(`runJob` 안)은 건드리지 않는다.** 긴 강제 실행을 멈출 유일한 장치다.

- [ ] **Step 4: 세션 테스트를 더한다**

`tests/desktop/orchestrator.test.ts`에 더한다.

- 운영 시간 밖 + `FORCED` → 세션이 열린다
- 운영 시간 밖 + `MANUAL` → `OUTSIDE_ACTIVE_HOURS`로 거절
- 밀린 작업이 오래됐어도 `FORCED`는 열린다
- `FORCED`도 전면 정지면 `KILLED`
- `FORCED`도 자동화가 꺼져 있으면 `DISABLED`
- `FORCED`가 하루 상한을 넘긴 뒤에도 계속 처리한다
- 처리 도중 전면 정지가 켜지면 다음 한 건 안에 멈춘다

- [ ] **Step 5: 배선을 맞춘다**

`session.ts`의 `createSessionRunner`가 모드를 받아 넘긴다. `sessionLoop.runOnce`와 `bootstrap`의 `AutomationControl.runOnce`도 모드를 받는다. 스케줄러가 스스로 부를 때는 언제나 `SCHEDULED`다.

- [ ] **Step 6: 전체를 확인하고 커밋한다**

```bash
git add -A
git commit -m "feat: let an operator run past the operating window"
```

---

## Task 3: 날짜 지정 실행

**Files:**
- Modify: `src/desktop/orchestrator.ts`, `src/desktop/session.ts`, `src/desktop/sessionLoop.ts`, `src/desktop/bootstrap.ts`
- Test: `tests/desktop/orchestrator.test.ts`, `tests/desktop/session.test.ts`

**Interfaces:**
- Produces: `SessionDeps.dayStartMs`

- [ ] **Step 1: 테스트를 먼저 쓴다**

`tests/desktop/orchestrator.test.ts`에 더한다.

- 지정한 날짜의 0시를 바닥으로 수집을 요청한다
- 지정한 날짜 24시 이후의 글은 판정 대상에서 잘려 나간다
- **자르기가 작성자별 최초 글 판정보다 먼저 일어난다** — 같은 작성자가 지정일에 한 번, 다음 날에 한 번 썼다면 지정일 글이 대상이다
- 날짜를 주지 않으면 오늘이다

세 번째가 이 작업의 핵심이다. 자르기가 나중에 일어나면 다음 날 글이 "최초"가 되어 지정일 글이 건너뛰어진다.

- [ ] **Step 2: 실패를 확인하고 구현한다**

`SessionDeps`에 `dayStartMs`를 더한다. 수집 바닥은 그 값이고, 받아온 후보는 `dayStartMs + 하루` 미만으로 거른 뒤 `firstPostIdByAuthor`에 넘긴다.

리허설 스크립트(`scripts/dry-run.mjs`)가 이미 같은 자르기를 하고 있다. 계산이 두 벌이 되지 않도록, 하루를 자르는 부분을 공유할 수 있으면 공유한다.

- [ ] **Step 3: 미래 날짜를 막는다**

`session.ts` 또는 그 위에서 미래 날짜를 거절한다. 어디서 막든, 렌더러가 아니라 앱이 판정한다.

- [ ] **Step 4: 배선**

`AutomationControl`에 날짜를 받는 실행을 더한다. 모드는 언제나 `FORCED`다.

- [ ] **Step 5: 전체를 확인하고 커밋한다**

```bash
git add -A
git commit -m "feat: work a chosen day's greetings"
```

---

## Task 4: 수동 실행 중 스케줄러 건너뛰기

**Files:**
- Modify: `src/desktop/sessionLoop.ts`
- Test: `tests/desktop/sessionLoop.test.ts`

- [ ] **Step 1: 테스트를 먼저 쓴다**

- 수동 실행이 진행 중일 때 예약된 차례가 오면 세션을 시작하지 않는다
- 건너뛴 차례는 결과를 보고하지 않는다 — 대시보드의 마지막 세션이 수동 실행 결과로 덮이지 않는다
- 수동 실행이 끝나면 다음 차례가 다시 잡힌다
- 진행 중인 것이 없으면 예약된 차례는 평소대로 돈다

- [ ] **Step 2: 실패를 확인하고 구현한다**

지금은 단일 실행 보장을 위해 예약된 차례가 진행 중인 실행에 합류한다. 합류 대신 건너뛰되, **수동 실행이 진행 중일 때만** 그렇게 한다. 진행 중인 실행이 무엇인지 알아야 하므로 그 사실을 들고 있어야 한다.

- [ ] **Step 3: 전체를 확인하고 커밋한다**

```bash
git add -A
git commit -m "fix: let a scheduled turn stand aside for a manual run"
```

---

## Task 5: 화면 — 확인 절차와 날짜 선택

**Files:**
- Modify: `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts`, `src/desktop/main.ts`, `src/renderer/api.ts`, `src/renderer/store.ts`, `src/renderer/views/Dashboard.tsx`, `src/renderer/locales/ko.ts`, `src/renderer/styles.css`
- Test: `tests/desktop/rendererApi.test.ts`, `tests/renderer/store.test.ts`, `tests/renderer/format.test.ts`

- [ ] **Step 1: 앱이 운영 시간 여부를 알려준다**

`DashboardSnapshot`에 `withinActiveHours: boolean`을 더한다. 렌더러가 시간대 계산을 다시 구현하면 두 곳이 다른 답을 낼 수 있다.

`rendererApi.test.ts`에 운영 시간 안팎을 각각 덮는 테스트를 더한다.

- [ ] **Step 2: 실행 지시에 모드와 날짜를 싣는다**

`RendererApi.runOnce`가 강제 여부를 받고, 날짜를 받는 실행을 더한다. 둘 다 세션이 시작되면 곧바로 응답한다 — 하루치는 한 시간이 걸릴 수 있고, 그동안 렌더러가 기다리면 정지 버튼까지 잠긴다.

- [ ] **Step 3: 확인 절차**

운영 시간 안에서 `한 번 실행`은 지금처럼 곧바로 돈다. 운영 시간 밖이면 확인을 먼저 띄운다. 확인에는 **무엇을 넘기게 되는지**와 **대상 건수**, **예상 소요 시간**이 보여야 한다. 취소하면 아무 일도 일어나지 않는다.

날짜 지정 실행은 언제나 확인을 거친다.

예상 시간은 대상 건수 × 한 건당 평균 간격으로 낸다. 간격 값은 이미 `src/shared/schedule.ts`에 있다 — 화면에 숫자를 새로 박지 않는다.

- [ ] **Step 4: 날짜 선택**

날짜를 고르는 입력을 대시보드에 둔다. 미래 날짜는 고를 수 없다. 문구는 전부 로케일에 둔다.

- [ ] **Step 5: 문구를 실제로 그려본다**

`tests/renderer/progressWording.test.ts`가 하는 방식대로, 새로 넣은 문구를 i18next로 그려 중괄호가 남지 않는지 확인한다. 키를 맞게 고르는 것과 i18next가 그 문구를 이해하는 것은 다른 주장이다.

- [ ] **Step 6: 전체를 확인하고 커밋한다**

```bash
git add -A
git commit -m "feat: ask before running outside the operating window"
```

---

## Task 6: 문서와 종단 확인

- [ ] **Step 1: 리허설 스크립트를 맞춘다**

`scripts/dry-run.mjs`가 이미 날짜를 받는다. 세션의 자르기와 같은 계산을 쓰는지 확인하고, 다르면 하나로 모은다.

- [ ] **Step 2: 남은 참조를 찾는다**

Run: `grep -rn "isManualRun\|dailyWindowStart\|countExecutedSince\|countByStatusSince" src tests scripts`

- [ ] **Step 3: 쓰지 않는 스모크 테스트**

Run: `pnpm build && node scripts/dry-run.mjs 1`

어제 기준 대상과 건너뜀 사유가 예상대로인지 본다. 글은 쓰지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "docs: record the run modes and the day a run targets"
```
