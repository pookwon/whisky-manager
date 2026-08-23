# 기능 단위 메뉴 · 설정 분리 설계

> 2026-08-23. [네이버 카페 자동화 설계](2026-08-22-naver-cafe-automation-design.md)의 §5.1(자동화 모델 경계)을 전제로 한다.

## 1. 목표

자동화 기능을 메뉴에 기능 단위로 담고, 승인 큐·문구·자동화 설정을 기능별로, 카페·계정 설정을 공통으로 분리한다. 기능을 추가할 자리를 만드는 것이 목적이며, **지금 추가할 2번째 기능은 없다.**

## 2. 경계 — 무엇을 만들고 무엇을 만들지 않는가

설계 스펙 §5.1은 `Automation` 인터페이스와 레지스트리를 **2번째 자동화가 실제로 생길 때까지 만들지 않는다**고 못박았다. 하나의 사례에서 뽑은 인터페이스는 두 번째 사례를 만나면 대개 틀리기 때문이다. 그 판단은 지금도 유효하다.

**만드는 것: UI·설정 계층의 기능 스코프.** 메뉴, 라우팅, 설정 화면, IPC 파라미터를 `automationId`로 연다. DB는 이미 모든 테이블이 `automation_id`로 키가 잡혀 있어(§executions, templates, automation_settings, watermarks) 데이터 모델 변경은 게시판 ID 이동 하나뿐이다.

**만들지 않는 것: 동작 추상화.** 수집·판단·실행을 감싸는 인터페이스는 만들지 않는다. 실행 루프는 여전히 환영 댓글 하나만 돈다.

**두 계층이 어긋나지 않도록 하는 장치는 만든다.** 아래 §6.

## 3. 자동화 카탈로그

`src/shared/automations/catalog.ts` — 순수 데이터. 인터페이스도 동작도 없다.

```ts
export type AutomationPanel = 'approvals' | 'templates' | 'settings'

export interface AutomationDescriptor {
  readonly id: string
  readonly labelKey: string
  readonly panels: readonly AutomationPanel[]
}

export const AUTOMATIONS: readonly AutomationDescriptor[] = [
  {
    id: 'welcome-comment',
    labelKey: 'automation.welcomeComment',
    panels: ['approvals', 'templates', 'settings'],
  },
]
```

메뉴에 기능을 추가하는 일은 이 배열에 한 줄 더하는 일이다.

**`panels`를 두는 이유.** 없애면 네비게이션이 "모든 자동화는 승인·문구·설정 세 패널을 갖는다"고 가정하게 된다. 그 가정은 §5.1이 이미 반례를 들어둔 것이다 — 정기 공지는 감시 대상이 없어 승인 큐가 성립하지 않고, 등업 승인은 문구가 없다. `panels`는 그 가정을 데이터로 끌어내 한 줄로 고칠 수 있게 만든다. 가정을 늘리는 것이 아니라 줄인다.

## 4. 설정 분리

| 항목 | 저장 위치 | 변경 |
|---|---|---|
| 활성화(`enabled`) | `automation_settings` | 없음. 이미 기능별 |
| 승인 정책(`policy`) | `automation_settings` | 없음. 이미 기능별 |
| 한도(`limits`) | `automation_settings` | 없음. 이미 기능별 |
| **게시판 ID** | `app_settings` → **`automation_settings`** | 컬럼 추가 + 백필 |
| 카페 ID · 카페 주소 | `app_settings` | 없음. 공통 |
| 운영진 계정 | `app_settings` | 없음. 공통 |
| 페어링 토큰 | `app_settings` | 없음. 공통 |

게시판 ID가 기능별인 이유: 가입인사 게시판(5번)은 환영 댓글 기능에 종속된 값이다. 다른 게시판을 감시하는 기능이 생기면 각자의 게시판을 가져야 한다. 카페 ID는 앱 전체가 한 카페를 대상으로 하므로 공통으로 남는다.

### 4.1 마이그레이션

`automation_settings`에 `board_id` 컬럼을 더한다.

1. `board_id TEXT` 를 **nullable로** 추가한다.
2. 기존 행을 백필한다 — `app_settings`의 `boardId` 값이 있으면 그 값, 없으면 `DEFAULT_BOARD_ID`.
3. 백필 후 `NOT NULL` 제약을 걸지 않는다. 읽는 쪽이 `?? DEFAULT_BOARD_ID`로 처리하며, SQLite에서 제약 추가는 테이블 재작성을 요구해 이득 대비 비용이 크다.
4. `app_settings`의 `boardId` 키는 **삭제하지 않는다.** 롤백 시 데이터가 남아 있어야 한다. 읽는 코드만 옮긴다.

**게시판을 바꿨을 때의 동작.** 워터마크는 `(cafe_id, automation_id, board_id)`로 키가 잡혀 있다. 게시판을 바꾸면 새 키로 조회되어 워터마크가 없는 상태가 되고, 그 게시판의 새 글부터 감시가 시작된다. 옛 게시판의 워터마크 행은 남지만 다시 읽히지 않는다. 이는 올바른 동작이다 — 감시 대상이 바뀌면 추적도 새로 시작해야 한다. `executions`의 과거 행도 그대로 남아 이력이 보존된다.

## 5. 네비게이션

평면 문자열 `ViewName`을 라우트 유니온으로 바꾼다.

```ts
export type Route =
  | { readonly kind: 'dashboard' }
  | { readonly kind: 'automation'; readonly id: string; readonly panel: AutomationPanel }
  | { readonly kind: 'commonSettings' }
```

사이드바는 대시보드 → 기능별 섹션(카탈로그 순서대로, 각 기능의 `panels`만) → 공통 설정 순으로 그린다. 승인 대기 건수 배지는 해당 기능의 승인 큐 항목에 붙는다.

## 6. 카탈로그와 런타임의 정합성

카탈로그에 기능을 넣어도 실행 루프가 그것을 모르면, 사용자는 켜둔 기능이 도는 줄 알고 하루를 흘려보낸다. 0건이 "아직 대상이 없음"인지 "아예 안 돎"인지 화면으로 구분되지 않기 때문이다.

이를 UI 배너나 규율로 막지 않는다. **부팅 시점에 실패시킨다.**

`bootstrap.ts`는 `automationId → 세션 러너`를 만드는 맵을 갖는다. 앱 시작 시 카탈로그의 모든 항목이 이 맵에 있는지 검사하고, 없으면 즉시 예외를 던진다.

```ts
const RUNTIMES: Record<string, (deps: SessionRunnerOptions) => () => Promise<SessionOutcome>> = {
  [WELCOME_AUTOMATION_ID]: createSessionRunner,
}

for (const automation of AUTOMATIONS) {
  if (!(automation.id in RUNTIMES)) {
    throw new Error(`automation "${automation.id}" has no runtime registered`)
  }
}
```

효과는 세 가지다. 런타임 없는 기능이 메뉴에 뜨는 상태가 존재할 수 없다. 카탈로그에 줄을 더한 개발자는 앱을 켜는 즉시 무엇이 빠졌는지 안다. 그리고 이 맵이 2번째 자동화의 런타임이 붙을 이음매가 되어, §5.1이 말한 "두 구현의 공통점을 보고 추출한다"를 할 자리가 코드에 남는다.

## 7. IPC

단일 `RendererApi` 인스턴스를 유지하고 기능 스코프 메서드에 `automationId`를 파라미터로 받는다. 채널을 기능별로 늘리지 않는다 — 채널 수가 기능 수에 비례해 늘면 `main.ts`의 등록 루프가 카탈로그를 알아야 하고, 그러면 §6의 검사가 이중화된다.

| 메서드 | 변경 |
|---|---|
| `listAwaiting(automationId)` | 파라미터 추가 |
| `listTemplates(automationId)` | 파라미터 추가 |
| `addTemplate(automationId, body)` | 파라미터 추가 |
| `setPolicy(automationId, policy)` | 파라미터 추가 |
| `setEnabled(automationId, enabled)` | 파라미터 추가 |
| `getAutomationSettings(automationId)` | 신규. `policy`·`enabled`·`boardId` |
| `setBoardId(automationId, boardId)` | 신규 |
| `getCommonSettings()` | 기존 `getSettings`에서 개명. `boardId` 빠짐 |
| `setCafe(cafeId, cafeUrlName)` | `boardId` 파라미터 제거 |
| `getDashboard()` | 합산 + 기능별 행 반환 (§8) |
| `approve(id)` · `reject(id)` · `removeTemplate(id)` | 변경 없음. id가 전역 유일 |
| `setOperatorAccounts` · `getPairingToken` · `startAutomation` · `stopAutomation` · `killSwitch` · `runOnce` | 변경 없음 |

`createRendererApi`는 고정 `automationId` 의존을 잃는다.

## 8. 대시보드

```ts
export interface DashboardSnapshot {
  readonly bridgeConnected: boolean
  readonly loopRunning: boolean
  readonly executedToday: number      // 전체 합산
  readonly succeededToday: number
  readonly failedToday: number
  readonly awaitingApproval: number
  readonly automations: readonly AutomationStatus[]
}

export interface AutomationStatus {
  readonly id: string
  readonly enabled: boolean
  readonly awaitingApproval: number
  readonly executedToday: number
  readonly lastOutcome: SessionOutcome | null
}
```

상단은 전체 합산 수치, 아래는 기능별 한 줄(이름·상태·대기 건수·활성 토글). `lastOutcome`이 기능별로 내려가므로 "왜 조용한가"를 기능 단위로 답할 수 있다.

## 9. 렌더러 상태

스토어는 현재 화면이 가리키는 기능의 데이터만 들고 있는다. 기능별 데이터를 전부 캐시하지 않는다 — 기능이 늘면 5초 폴링이 기능 수만큼 늘어나고, 보고 있지도 않은 화면 때문에 카페에 요청이 늘어난다.

```ts
interface AppState {
  route: Route
  dashboard: DashboardSnapshot | null   // 대시보드는 항상 폴링(기능별 요약 포함)
  awaiting: AwaitingItem[]              // 현재 라우트의 기능 것
  templates: Template[]                 // 현재 라우트의 기능 것
  automationSettings: AutomationSettingsView | null
  commonSettings: CommonSettingsView | null
  cafeImage: string | null
  busy: boolean
  error: string | null
}
```

`refresh()`는 현재 라우트를 보고 필요한 것만 부른다. 라우트가 바뀌면 즉시 한 번 부른다.

## 10. 뷰 구성

`Approvals` · `Templates` · `AutomationSettings` 는 `automationId`를 props로 받는 컴포넌트가 된다. 전역 싱글턴처럼 스토어에서 직접 읽지 않는다. `CommonSettings`는 파라미터가 없다.

현재 `Settings.tsx`는 기능 설정과 공통 설정이 한 파일에 섞여 있다. 이를 `views/AutomationSettings.tsx`(활성화·승인 정책·게시판 ID)와 `views/CommonSettings.tsx`(카페·운영진 계정·페어링 토큰)로 나눈다. 파일 하나가 한 가지 이유로만 바뀌게 된다.

## 11. 구현 순서

두 단계로 나눈다. 1단계는 화면에 아무 변화가 없어야 하며, 그 사실이 1단계가 옳게 되었다는 증거다.

**1단계 — 데이터 계층.** `board_id` 컬럼 추가와 백필, `session.ts`가 자동화 설정에서 게시판을 읽도록 변경, `rendererApi`에 `setBoardId`·`getAutomationSettings` 추가, §6의 부팅 검사 추가. UI는 건드리지 않는다.

**2단계 — UI 계층.** 카탈로그, 라우트, 사이드바, 뷰 분할, 기능별 IPC 파라미터, 대시보드 기능별 행.

## 12. 테스트

- **마이그레이션**: 기존 `app_settings.boardId`가 있는 DB와 없는 DB 각각에서 백필 결과 확인
- **`automationSettingsRepo`**: `boardId` 왕복, 미설정 시 기본값
- **`session.ts`**: 게시판을 자동화 설정에서 읽는지, 게시판 변경 시 워터마크가 새 키로 조회되는지
- **부팅 검사**: 런타임 없는 카탈로그 항목이 있으면 예외를 던지는지
- **`rendererApi`**: 서로 다른 `automationId`의 문구·설정·승인 큐가 섞이지 않는지 (기능 두 개를 넣은 픽스처로)
- **대시보드**: 합산 수치가 기능별 합과 일치하는지

## 13. 다루지 않는 것

- 2번째 자동화의 동작 구현. 생길 때 두 구현의 공통점을 보고 추출한다(§5.1)
- 기능별 실행 루프 다중화. 런타임이 하나뿐이므로 루프도 하나다
- 카페 다중화. 앱은 한 카페를 대상으로 한다
