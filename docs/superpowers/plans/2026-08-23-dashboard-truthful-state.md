# 대시보드 상태 표시 바로잡기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 superpowers:executing-plans.

**Goal:** 대시보드가 과거의 판정을 현재 상태처럼 보여주지 않게 하고, 조용한 이유를 화면에서 답할 수 있게 한다.

**Architecture:** 세 가지 사실을 스냅샷에 추가한다 — 마지막 결과가 *언제* 나왔는지, 다음 세션이 *언제*인지, 브릿지가 *재연결 중인지 정말 끊겼는지*. 렌더러는 그 값을 그대로 보여준다. 판정 로직은 건드리지 않는다.

**Tech Stack:** TypeScript, Electron, React 렌더러, Vitest.

## 실제로 관찰된 증상

운영자가 라이브에서 겪은 그대로다.

- 자동화를 켜고 시작을 눌렀는데 같은 줄에 **"환영댓글 자동화가 꺼져있습니다"와 "동작중"이 같이** 떴다. 각각은 참이다 — 앞은 *과거 세션*의 거부 사유, 뒤는 *현재* 루프 상태다. 시점이 다른 두 사실을 나란히 놓아 모순으로 보였다.
- "한 번 실행"을 눌러도 화면이 바뀌지 않았다. 세션은 돌았지만 거부됐고, **거부는 실행 이력을 남기지 않으며** 배너 문구가 이전과 같아 아무 일도 안 일어난 것처럼 보였다.
- 확장 연결이 **60초 주기로 30초 붙고 30초 끊김**을 반복했다. MV3 서비스 워커가 유휴 시 종료되며 소켓을 가져가고 1분 알람이 깨우는, 설계대로의 동작이다. 화면은 정직했지만 운영자에게는 고장으로 보였다.

## Global Constraints

- 코드와 주석은 **영어**, 화면 문구는 한국어이며 locale 파일에 둔다
- 커밋에 AI 서명·공동저자·이모지 금지
- 주석은 *왜*를 설명하고 계획 태스크 번호를 참조하지 않는다
- TDD: 실패하는 테스트 → 최소 구현 → 통과 → 커밋
- **상태를 뭉개지 않는다.** "재연결 중"과 "끊김"은 다른 값이며 한 불리언으로 합치지 않는다. 이 저장소가 `null`과 `[]`를 구분해온 것과 같은 규율이다
- 판정·실행 로직은 이 작업에서 바꾸지 않는다. 표시만 고친다
- 밝은/어두운 테마 모두 동작하고 색을 새로 하드코딩하지 않는다

## File Structure

| 파일 | 책임 |
|---|---|
| `src/desktop/sessionLoop.ts` | 다음 세션 예정 시각을 노출 (수정) |
| `src/desktop/bootstrap.ts` | 결과 시각 기록, 브릿지 상태 판정 (수정) |
| `src/desktop/ipc.ts` | 스냅샷 필드 세 개 (수정) |
| `src/desktop/rendererApi.ts` | 스냅샷에 싣기 (수정) |
| `src/renderer/views/Dashboard.tsx` | 표시 (수정) |
| `src/renderer/format.ts` | 경과 시간·상태 문구 (수정) |
| `src/renderer/locales/ko.ts` | 문구 (수정) |

---

### Task 1: 사실 세 가지를 스냅샷에 싣는다

**Files:**
- Modify: `src/desktop/sessionLoop.ts`, `src/desktop/bootstrap.ts`, `src/desktop/ipc.ts`, `src/desktop/rendererApi.ts`
- Test: `tests/desktop/sessionLoop.test.ts`, `tests/desktop/bootstrap.test.ts`

**Produces:**

```ts
/** 소켓이 붙어 있는가, 재연결을 기다리는 중인가, 정말 끊겼는가. */
export type BridgeStatus = 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'

// DashboardSnapshot에 추가
readonly lastOutcomeAt: number | null
readonly nextSessionAt: number | null
readonly bridgeStatus: BridgeStatus
```

`SessionLoop`에 `nextRunAt(): number | null`을 더한다. 루프가 돌고 있지 않으면 `null`이다.

**브릿지 상태 규칙.** 소켓이 붙어 있으면 `CONNECTED`. 끊겨 있으면, 마지막으로 붙어 있던 시점부터 **재연결 주기보다 넉넉히 긴 유예**(90초) 안이면 `RECONNECTING`, 그보다 오래면 `OFFLINE`. 확장이 한 번도 붙은 적 없으면 `OFFLINE`이다.

**90초인 이유를 주석에 남긴다** — 확장의 재연결 알람이 1분 주기라, 그보다 짧게 잡으면 정상 왕복이 `OFFLINE`으로 보인다.

**기존 `bridgeConnected`는 그대로 둔다.** 소켓의 사실을 그대로 말하는 값이며, 이번에 더하는 것은 표시용 해석이다. 둘을 합치지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `nextRunAt()`이 `start()` 전에는 `null`, 후에는 미래 시각, `stop()` 후 다시 `null`
  - 결과가 도착하면 `lastOutcomeAt`이 그 시각으로 기록된다
  - 붙어 있으면 `CONNECTED`
  - 끊긴 지 30초면 `RECONNECTING`
  - 끊긴 지 120초면 `OFFLINE`
  - 한 번도 붙은 적 없으면 `OFFLINE`
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm vitest run && pnpm typecheck && pnpm lint`
- [ ] **Step 5: 커밋** — `feat: report when the last session ran and whether the bridge is reconnecting`

---

### Task 2: 화면이 시점을 구분해 보여준다

**Files:**
- Modify: `src/renderer/format.ts`, `src/renderer/views/Dashboard.tsx`, `src/renderer/locales/ko.ts`
- Test: `tests/renderer/format.test.ts`

**마지막 결과는 과거로 표시한다.** 문구 앞에 경과 시간을 붙여 `마지막 세션 · 12분 전`처럼 보이게 한다. 시점이 보이면 "지금 그렇다"로 읽히지 않는다.

**현재 설정이 부정하는 거부 사유는 헤드라인에서 내린다.** `DISABLED`로 거부됐는데 지금 자동화가 켜져 있다면 그 문구는 더 이상 현재를 설명하지 않는다. 그 경우 "아직 이번 설정으로 돈 적 없음"에 해당하는 문구를 보여준다. `automation.enabled`로 판단할 수 있다.

**다음 세션 예정 시각을 보여준다.** 루프가 돌고 있으면 `다음 세션 · 오후 10:15` 형태로 배너에 싣는다. 45~75분 주기라 켠 직후 아무 일도 없는 것이 정상인데, 지금은 화면에 그 사실이 없다.

**브릿지는 세 상태를 각각 다르게 보여준다.** `연결됨` / `연결 대기 중` / `끊김`. `RECONNECTING`을 `끊김`과 같은 톤으로 그리면 고친 의미가 없다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 경과 시간 포맷과 상태 문구 선택을 `format.ts`의 순수 함수로 빼서 검증한다. 이 저장소에는 컴포넌트 렌더링 하네스가 없으므로 테스트 의존성을 새로 추가하지 않는다
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build:renderer`
- [ ] **Step 5: 커밋** — `feat: show when the last session ran and when the next one is due`

## 마무리 확인

- [ ] 꺼짐으로 거부된 뒤 켜면 그 문구가 헤드라인에서 사라진다
- [ ] 루프가 돌면 다음 세션 시각이 보인다
- [ ] 30초 왕복이 `끊김`으로 보이지 않는다
- [ ] 정말 확장을 끄면 90초 뒤 `끊김`으로 바뀐다
