# 첫 수확 범위와 수동 실행 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans.

**Goal:** 수동 실행이 그날 올라온 가입인사를 오래된 순으로 전부 처리하게 한다. 스케줄된 세션은 지금처럼 추가분만 띄엄띄엄 처리한다.

**Architecture:** 수집의 바닥을 "1페이지"가 아니라 "오늘 0시"로 바꾸고, 그 바닥을 앱이 정해 확장에 넘긴다. 그리고 세션당 상한을 스케줄된 세션에만 적용한다.

**Tech Stack:** TypeScript, Electron, Chrome MV3 확장, Vitest.

## 왜 고치는가 — 실제로 일어난 일

첫 실행이 5건만 처리하고 워터마크를 가장 최신 글로 올렸다. 그 결과 **그날 아침에 가입한 사람들이 영영 대상에서 빠졌다.** 리허설에서 대상으로 확인됐던 세 명이 실제로 그렇게 누락됐다.

원인은 `cafeClient.collect`의 이 줄이다.

```ts
const pageLimit = sincePostId === null ? 1 : MAX_PAGES
```

의도는 옳았다 — 새 설치가 20만 건짜리 게시판을 통째로 훑는 것을 막으려 했다. 그러나 바닥을 "1페이지"로 잡는 바람에 오늘치까지 잘렸다. **올바른 바닥은 페이지 수가 아니라 시각이다.**

두 번째 문제는 상한이다. 바닥을 고쳐도 세션당 15건에서 잘려 오늘치를 한 번에 끝낼 수 없다. 세션당 상한은 *스케줄된* 활동을 사람처럼 보이게 하려는 장치이고, **사람이 직접 누른 실행에는 그 전제가 성립하지 않는다.**

## Global Constraints

- 코드와 주석은 **영어**, 화면 문구는 한국어이며 locale 파일에 둔다
- 커밋에 AI 서명·공동저자·이모지 금지
- 주석은 *왜*를 설명하고 계획 태스크 번호를 참조하지 않는다
- TDD: 실패하는 테스트 → 최소 구현 → 통과 → 커밋
- **판단은 앱에, 수집·실행만 확장에.** 확장이 "오늘"이 언제인지 스스로 정하지 않는다. 앱이 바닥 시각을 계산해 넘긴다
- **일일 상한 200건은 어떤 경우에도 그대로다.** 이것은 페이스 조절이 아니라 남용 방지다
- 글 간 간격(8~25초)은 수동 실행에도 그대로 적용한다
- 가입일·시각 판정은 KST 달력 기준이며 `src/shared/kst.ts`를 쓴다

## File Structure

| 파일 | 책임 |
|---|---|
| `src/shared/kst.ts` | 하루의 시작 시각 계산 (수정) |
| `src/shared/protocol.ts` | `COLLECT`에 바닥 시각 (수정) |
| `src/extension/cafeClient.ts` | 바닥에 닿을 때까지 페이징 (수정) |
| `src/desktop/orchestrator.ts` | 바닥을 수집에 전달 (수정) |
| `src/desktop/session.ts` | 바닥 계산, 수동 여부 전달 (수정) |
| `src/desktop/sessionLoop.ts` | 수동 실행 표시 (수정) |

---

### Task 1: 첫 수확의 바닥을 오늘 0시로

**Files:**
- Modify: `src/shared/kst.ts`, `src/shared/protocol.ts`, `src/extension/cafeClient.ts`, `src/desktop/orchestrator.ts`, `src/desktop/session.ts`
- Test: `tests/shared/kst.test.ts`, `tests/extension/cafeClient.test.ts`, `tests/shared/protocol.test.ts`

**Produces:**
- `kstDayStartMs(epochMs: number): number` — 그 시각이 속한 KST 날짜의 0시를 epoch ms로
- `COLLECT` 메시지에 `sincePostedAt: number | null`
- `CafeClient.collect(source, sincePostId, sincePostedAt)`

**규칙.** 워터마크(`sincePostId`)가 있으면 지금 동작 그대로다 — 워터마크에 닿을 때까지 최대 10페이지. 워터마크가 **없을 때만** `sincePostedAt`을 바닥으로 삼아, 그보다 오래된 글을 만날 때까지 페이지를 거슬러 오른다.

**첫 수확 페이지 상한은 40페이지다.** 한 페이지 5건이므로 200건까지 닿는다 — 이 카페의 하루 가입자(100~150명)를 덮으면서도 게시판 전체를 걷지 않는다. 상한에 걸려 멈췄다면 그 사실이 드러나야 하므로 로그를 남긴다.

**프로토콜 버전을 3으로 올린다.** 옛 확장은 새 필드를 무시하고 조용히 1페이지만 읽는다 — 고쳤는데 고쳐지지 않은 상태가 가장 나쁘다. 버전을 올리면 페어링에서 즉시 막힌다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `kstDayStartMs`: KST 자정 직후와 그날 늦은 시각이 같은 값을 낸다. UTC 자정과 헷갈리지 않는다
  - `collect`: 워터마크가 없고 바닥이 주어지면, 바닥보다 오래된 글이 나올 때까지 여러 페이지를 읽는다
  - `collect`: 바닥보다 오래된 글만 있는 페이지를 만나면 멈춘다
  - `collect`: 워터마크가 있으면 바닥은 무시하고 기존 동작을 지킨다
  - `collect`: 40페이지에서 멈춘다
  - 반환은 오래된 순 정렬을 유지한다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm vitest run && pnpm typecheck && pnpm lint`
- [ ] **Step 5: 커밋** — `fix: harvest the whole day on the first run`

---

### Task 2: 수동 실행은 그날 것을 끝까지

**Files:**
- Modify: `src/desktop/session.ts`, `src/desktop/sessionLoop.ts`
- Test: `tests/desktop/sessionLoop.test.ts`, `tests/desktop/session.test.ts`, `tests/desktop/orchestrator.test.ts`

**규칙.** 스케줄된 세션은 지금 그대로 세션당 15건에서 멈춘다. **수동 실행은 세션당 상한을 적용하지 않고 일일 상한(200건)까지 간다.**

세션당 상한은 스케줄된 활동을 띄엄띄엄 보이게 하려는 장치다. 사람이 직접 누른 실행은 그 전제가 다르다 — 앉은 김에 그날 것을 끝낸다.

**일일 상한과 글 간 간격은 그대로다.** 전자는 남용 방지, 후자는 한 건씩의 리듬이며 둘 다 수동이라고 풀어줄 이유가 없다.

`runOnce()`가 스케줄된 경로와 구분돼야 한다. 상한만 바꾸고 판정·안전장치는 하나도 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - 수동 실행은 후보 20건을 세션당 상한(15)에 걸리지 않고 처리한다
  - 수동 실행도 일일 상한에서는 멈춘다
  - 스케줄된 세션은 여전히 15건에서 멈춘다
  - 수동 실행도 글 사이에 간격을 둔다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm vitest run && pnpm typecheck && pnpm lint`
- [ ] **Step 5: 커밋** — `feat: let a manual run finish the day`

## 마무리 확인

- [ ] 워터마크가 없으면 오늘 0시까지 거슬러 수집한다
- [ ] 워터마크가 있으면 기존 동작이 그대로다
- [ ] 수동 실행이 15건에서 잘리지 않는다
- [ ] 일일 상한 200건은 수동에서도 지켜진다
- [ ] `PROTOCOL_VERSION`이 3이다 — **운영자는 확장을 다시 로드해야 한다**
