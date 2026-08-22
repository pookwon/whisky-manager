# 데스크톱 렌더러 구현 계획 (Phase 4 — C2)

**Goal:** 운영자가 상태를 보고, 승인 큐를 처리하고, 정책·문구를 바꾸는 화면을 만든다. 대시보드형.

**선행:** C1(`2026-08-22-desktop-headless.md`) 완료 — 세션 루프, 승인·재시도, IPC 계약, Electron 셸

> **이 계획서는 코드를 복제하지 않는다.** 같은 세션에서 바로 구현하므로 결정·인터페이스·태스크 분해까지만 기록한다. 구현은 C1과 동일하게 TDD로 진행하며, 실제 코드는 저장소가 단일 진실이다.

## 설계 결정

**테스트 가능성이 구조를 정한다.** Electron IPC 핸들러와 React 컴포넌트는 단위 테스트가 비싸다. 그래서 화면이 필요로 하는 로직을 전부 `createRendererApi(ctx)`라는 **Electron에 의존하지 않는 순수 객체**로 뽑는다. `main.ts`는 `ipcMain.handle(channel, api[name])`로 배선만 한다.

- `src/desktop/rendererApi.ts` — 전부 테스트 대상
- `src/desktop/main.ts` — 배선만. 테스트하지 않음(커버리지 제외 유지)
- 컴포넌트 — 표시 로직을 순수 함수(`src/renderer/format.ts`)로 뽑아 테스트하고, JSX는 얇게 유지

**UI 방향 — 대시보드형.** 상단에 상태 카드 행, 아래에 승인 큐. 좌측에 화면 전환.

**색은 3개.** 배경/전경 계열 1쌍 + accent 1. 상태 구분(성공·실패·대기)은 규칙이 허용하는 예외로 별도 색을 쓰되, 채도를 낮춰 accent와 경쟁하지 않게 한다.

**라이트·다크 양쪽.** CSS 변수로 토큰을 정의하고 `prefers-color-scheme`로 전환한다. 하드코딩된 색을 두지 않는다.

**i18n.** 사용자 노출 문자열은 전부 `i18next`를 거친다. 현재 로케일은 `ko` 하나지만 키를 통해 접근한다.

## 범위 밖

- **긴급 회수** — 실제 댓글 삭제는 확장의 엔드포인트를 알아야 하므로 Phase 3 의존. UI도 만들지 않는다. 동작하지 않는 버튼을 두는 것이 없는 것보다 나쁘다
- **통계 차트** — Phase 6. 지금은 오늘 처리량 숫자까지만

## 태스크

| # | 내용 | 검증 |
|---|---|---|
| 1 | 리포지토리 조회 보강 — `countByStatus`, `listAwaitingDetail` | 단위 테스트 |
| 2 | `rendererApi` — IPC 계약의 실제 구현 | 단위 테스트 (Electron 없이) |
| 3 | 렌더러 빌드 — Vite + React 19 + Tailwind 4 + i18next | `pnpm build:renderer` 산출물 |
| 4 | 표시 로직 — `format.ts`(상대 시각, 상태 라벨, 위험 신호 라벨) | 단위 테스트 |
| 5 | 화면 — 대시보드 / 승인 큐 / 템플릿 / 설정 | 빌드 + 수동 확인 |
| 6 | Electron 배선 — `ipcMain.handle`, 창 로드, 트레이 연동 | `pnpm start` |

## 인터페이스

### 리포지토리 (Task 1)

```ts
countByStatus(automationId: string, status: ExecutionStatus): number
listAwaitingDetail(automationId: string): AwaitingDetailRow[]
// AwaitingDetailRow: id, targetPostId, targetTitle, targetAuthor, renderedText, riskFlags, detectedAt
```

### RendererApi (Task 2)

C1의 `ipc.ts` 계약을 확장한다. C1 작성 시점에는 자동화 시작·정지와 운영진 계정 설정이 빠져 있었다.

```ts
getDashboard(): DashboardSnapshot          // 브리지 연결, 실행 여부, 승인 대기, 오늘 처리·성공·실패
listAwaiting(): AwaitingItem[]
approve(id) / reject(id)
listTemplates() / addTemplate(body) / removeTemplate(id)
getSettings(): SettingsView                // policy, enabled, cafeId, boardId, operatorAccounts
setPolicy(policy) / setEnabled(enabled)
setOperatorAccounts(accounts: string[])
setCafe(cafeId, boardId)
getPairingToken(): string
startAutomation() / stopAutomation() / killSwitch()
runOnce()                                  // 운영자가 지금 한 번 돌려보는 용도
```

`DashboardSnapshot`에 `lastOutcome: SessionOutcome | null`을 더한다. 세션이 왜 안 도는지(`DISABLED`, `NO_TEMPLATE`, `KILLED`, `NOT_LOGGED_IN`)를 운영자가 화면에서 봐야 한다. C1에서 이 거부 사유들을 명시적으로 만든 이유가 여기에 있다.

### 렌더러 구조

```
src/renderer/
├── index.html
├── main.tsx           마운트
├── App.tsx            레이아웃 + 화면 전환
├── api.ts             window.wm 래퍼 (타입 있는 RendererApi)
├── format.ts          순수 표시 로직
├── i18n.ts
├── locales/ko.ts
├── styles.css         토큰 + Tailwind
└── views/{Dashboard,Approvals,Templates,Settings}.tsx
```

상태는 Zustand 하나로 충분하다. 서버 상태가 없고 전부 로컬 IPC이므로 TanStack Query 같은 계층을 두지 않는다. 폴링은 대시보드가 5초 간격으로 `getDashboard`를 부르는 정도.
