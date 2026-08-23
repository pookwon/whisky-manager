# 시작 시 대상 미리보기 배너 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans.

**Goal:** 앱을 켜면 오늘 환영할 대상이 몇 명인지 자동으로 세어 대시보드에 알리고, 운영자가 보고 나서 시작하도록 한다.

**Architecture:** 세션이 쓰기 전에 하는 일(수집 → 멤버 목록 → 판정)만 그대로 돌려 개수를 세는 모듈을 두고, 브릿지가 처음 연결된 시점에 한 번 실행해 결과를 메모리에 담는다. 대시보드 스냅샷이 그 값을 실어 나르고, 렌더러가 배너로 보여준다. 자동으로 시작하지는 않는다.

**Tech Stack:** TypeScript, Electron, React 렌더러, Vitest.

## Global Constraints

- 코드와 주석은 **영어**, 사용자 화면 문구는 한국어이며 locale 파일에 둔다
- 커밋에 AI 서명·공동저자·이모지 금지
- 주석은 *왜*를 설명한다. 계획 태스크 번호를 참조하지 않는다
- TDD: 실패하는 테스트 → 최소 구현 → 통과 → 커밋
- 미리보기는 **절대 쓰지 않는다** — `claim` 없음, `EXECUTE` 없음, 실행 이력 행 없음
- 미리보기는 앱 실행당 **한 번만** 돈다. 대시보드를 열 때마다 카페에 요청하면 안 된다
- 앱은 스스로 자동화를 시작하지 않는다. 운영자가 누를 때만 시작한다
- 밝은/어두운 테마 모두에서 동작해야 하며 색을 새로 하드코딩하지 않는다

## File Structure

| 파일 | 책임 |
|---|---|
| `src/desktop/preview.ts` | 쓰기 없이 오늘 대상 수를 센다 |
| `src/desktop/ipc.ts` | `StartupPreview` 타입과 스냅샷 필드 (수정) |
| `src/desktop/bootstrap.ts` | 브릿지 연결 시 한 번 실행, 결과 보관 (수정) |
| `src/renderer/views/Dashboard.tsx` | 배너 (수정) |
| `src/renderer/locales/ko.ts` | 문구 (수정) |

---

### Task 1: 대상 수 세기

**Files:**
- Create: `src/desktop/preview.ts`
- Modify: `src/desktop/ipc.ts`
- Test: `tests/desktop/preview.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StartupPreview =
    | { kind: 'READY'; count: number; checkedAt: number }
    | { kind: 'UNAVAILABLE'; reason: 'BRIDGE_OFFLINE' | 'READ_FAILED' }

  export function previewToday(deps: PreviewDeps): Promise<StartupPreview>
  ```
- Consumes: `createMembershipResolver`, `newMemberGuard`, `evaluateGuards`, 트랜스포트의 `COLLECT`

**판정 규칙은 세션과 같아야 한다.** 미리보기가 세션과 다른 수를 말하면 배너는 거짓말이 된다. 같은 리졸버와 같은 guard 목록을 쓴다.

**보류(`DEFER`)는 세지 않는다.** 판정할 수 없는 글은 대상도 비대상도 아니다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/desktop/preview.test.ts`

`tests/desktop/membership.test.ts`의 가짜 트랜스포트·가짜 저장소 방식을 그대로 따른다. 최소한 이만큼 덮는다:

- 자동 생성 글 3건 → `{ kind: 'READY', count: 3 }`
- 그중 하나가 표에 없는 오래된 회원이 직접 쓴 글 → 그 건은 빠지고 나머지만 센다
- 트랜스포트가 연결돼 있지 않다 → `{ kind: 'UNAVAILABLE', reason: 'BRIDGE_OFFLINE' }`
- `COLLECT`가 실패한다 → `{ kind: 'UNAVAILABLE', reason: 'READ_FAILED' }`
- 멤버 목록 조회가 실패해 자동 생성 글만 판정 가능하다 → 자동 생성 글은 세고 보류된 글은 빼며 `READY`
- **쓰기가 없었음을 증명한다**: 가짜 트랜스포트가 받은 메시지 타입에 `EXECUTE`가 없다

- [ ] **Step 2: 실패 확인** — `pnpm vitest run tests/desktop/preview.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat: count today's greeting targets without writing`

---

### Task 2: 시작 시 실행과 배너

**Files:**
- Modify: `src/desktop/bootstrap.ts`, `src/desktop/ipc.ts`
- Modify: `src/renderer/views/Dashboard.tsx`, `src/renderer/locales/ko.ts`
- Test: `tests/desktop/bootstrap.test.ts`

**타이밍이 핵심이다.** 앱이 뜨는 순간에는 확장이 아직 붙지 않았을 수 있다. **브릿지가 처음 연결된 뒤에 한 번** 실행하고, 결과를 메모리에 담는다. 앱 실행 동안 다시 세지 않는다.

`DashboardSnapshot`에 `startupPreview: StartupPreview | null`을 더한다. `null`은 아직 세지 않았다는 뜻이다.

배너는 기존 배너 **위에** 별도 패널로 놓고, `startupPreview`가 `READY`이고 루프가 돌고 있지 않을 때만 보인다. 개수만 보여주고 닉네임은 싣지 않는다 — 대시보드에 개인정보를 늘리지 않는다. 시작 버튼은 새로 만들지 말고 기존 배너의 것을 쓴다.

`UNAVAILABLE`이면 개수 대신 이유를 보여준다. **0명과 "세지 못함"을 같은 화면으로 보여주면 안 된다.**

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 부트스트랩이 브릿지 연결 후 한 번만 미리보기를 돌리고 스냅샷에 싣는지
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm test && pnpm typecheck && pnpm lint && pnpm build:renderer`
- [ ] **Step 5: 커밋** — `feat: show today's target count when the app starts`

## 마무리 확인

- [ ] 미리보기가 카페에 보낸 메시지에 `EXECUTE`가 없다
- [ ] 앱 실행당 한 번만 센다
- [ ] 앱이 스스로 시작하지 않는다
- [ ] 0명과 "세지 못함"이 화면에서 구분된다
