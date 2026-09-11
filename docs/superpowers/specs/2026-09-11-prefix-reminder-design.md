# 말머리 안내 댓글 설계

- 작성일: 2026-09-11 (KST)
- 대상: 두 번째 자동화. 카페 전체의 오늘 글 가운데 말머리 없이 올라온 글에 안내 댓글을 단다.
- 상태: 설계 승인, 구현 전
- 전제 설계: `2026-08-22-naver-cafe-automation-design.md` §5.1 (두 번째 자동화가 생길 때 공통점을 뽑는다), `2026-08-30-cafe-article-list-contract.md` (전체글 목록 API)

## 1. 무엇을 하는가

주간 운영 창(10~24시) 안에서 약 2시간마다 카페 전체의 **오늘(KST) 글**을 읽고, 말머리가 없는 글에 운영자가 등록한 고정 문구로 댓글을 단다. 이미 운영자 계정 중 하나가 댓글을 단 글, 제외 게시판의 글, 운영자 본인의 글은 건너뛴다. 한 글에 한 번만 단다 — 회차가 몇 번 돌든.

가입인사 자동화(`welcome-comment`)와 같은 판단 계층 위에서 돈다: 승인 정책, 시간당·세션당 상한, 킬 스위치, 쓰기 직전 재확인, 재시도, 상태 기계, 어제 정산. 다른 것은 **무엇을 읽는가**, **무엇으로 거르는가**, **어느 엔드포인트로 댓글을 읽고 쓰는가** 셋뿐이다.

## 2. 무엇이 바뀌지 않는가

- `executions` 테이블과 중복 방지 키 `(cafeId, automationId, postId)`. 새 자동화는 자기 `automationId`로 자기 행을 갖는다. 스키마 변경 없음 — 행마다 이미 `board_id`가 있다.
- `runJob`의 게이트 → 대기 → 재확인 → 실행 → 기록 순서. 두 자동화가 이 한 문을 지난다.
- `PROFILES`의 운영 창, 시간당 상한(자동화별로 센다), 세션당 상한, 재시도 횟수, 승인 TTL.
- 네이버 읽기 게이트(`naverReadGate`). 두 세션과 수집이 모두 이 게이트를 지나므로 네이버로 가는 요청은 언제나 한 줄이다.
- 가입인사의 파서, 가드, 렌더러, 메모 게시판 엔드포인트, 시작 미리보기 배너.
- 로그인 확인. 카페 단위이므로 지금처럼 가입인사 게시판 페이지 한 곳에서 본다.

## 3. 판단 계층에서 자동화별로 올라가는 것

§5.1이 미뤄 둔 추출을 이번에 한다. 인터페이스나 레지스트리를 만들지 않는다. `SessionDeps`와 `createSessionRunner`가 받는 인자가 늘어나고, 부트스트랩이 카탈로그 항목마다 한 번 조립할 뿐이다.

| 지금 | 바뀐 뒤 |
|---|---|
| `workDay`가 `collectDay({transport, …, 'COLLECT'})`를 직접 부른다 | `SessionDeps.collectDay(dayStartMs, onProgress): Promise<RawCandidate[] \| null>`을 주입받는다. 가입인사의 `COLLECT` 호출은 가입인사 쪽 팩토리로 옮긴다. |
| `session.ts`가 `WELCOME_GUARDS`를 직접 참조한다 | `createSessionRunner` 옵션으로 `guards`를 받는다. |
| `SessionDeps.boardId` 하나. 세션은 한 게시판의 것 | `SessionDeps.boardId`를 없앤다. `RawCandidate`가 `boardId`를 갖고, 중복 방지 행과 실행 요청은 후보의 게시판을 쓴다. 가입인사 파서는 요청받은 게시판 id를 그대로 채운다. |
| `RawCandidate`, `Candidate`에 말머리가 없다 | `prefix: string \| null` 추가. 가입인사는 `null`. |
| `lastSettledDayStartMs` 설정 키 하나 | 자동화별 키. 가입인사는 기존 키를 그대로 써 값이 유지되고, 새 자동화는 `lastSettledDayStartMs:prefix-reminder`. |
| `bootstrap.ts`가 러너와 루프를 한 쌍 만든다 | 카탈로그 항목마다 한 쌍. `assertRuntimesRegistered`가 두 id를 요구한다. |

이 표의 변경은 **동작 변화 없는 리팩터링 커밋**으로 먼저 들어간다. 기존 `orchestrator.test.ts`, `session.test.ts`가 그대로 통과하는 것이 그 증거다.

`RawCandidate.boardId`는 프로토콜 메시지(`COLLECTED`)의 모양을 바꾸므로 `PROTOCOL_VERSION`을 올린다. 확장 라우팅(§6)도 같은 범프에 얹는다.

## 4. 수집 — 오늘 하루의 전체 카페 글

전체글 목록 API(`COLLECT_BOARD_PAGE`, `menuId: '0'`, 시간순)를 1페이지부터 걷는다. `createBoardPageFetcher`를 그대로 쓴다.

- 멈추는 조건: 페이지 안에 `postedAt < 자정(KST)`인 글이 있으면 그 페이지까지 읽고 멈춘다. 빈 페이지, 이전 페이지와 같은 `pageIdentity`도 멈춤.
- 페이지 간 간격: `nextPageFetchDelayMs`.
- 오늘 글은 하루 300건 안팎이므로 페이지 몇 장이다. 백필 수집기의 페이지 예산, 커서, 재개는 쓰지 않는다. 실제로 걷는 페이지 수가 `PAGES_WARNING_THRESHOLD`(20)를 넘으면 경고만 남긴다 — 멈춤 조건이 안 서는 것을 보이게 하려는 것이지 멈추려는 것이 아니다.
- 반환: 읽기 실패는 `null`(HTTP 오류, 파싱 오류, 응답 없음), 글 없는 하루는 `[]`. `collectDay`와 같은 구분이고, 같은 이유로 둘을 합치지 않는다.
- 자정 전 글은 `kstDayRange`로 잘라낸다. 어제 정산 회차가 어제 것을 본다.

`CollectedPostMetadata → RawCandidate` 변환: `boardId`, `prefix`, `commentCount`, `title`, `authorId`(memberKey), `authorNickname`, `postedAt`을 옮긴다. `bodyText`는 목록에 없으므로 `null`. 고정 문구라 본문은 필요 없다.

## 5. 판정 — 가드

```ts
export function prefixReminderGuards(options): readonly Guard[] {
  return [
    operatorAlreadyCommentedGuard,          // 기존
    authorIsOperatorGuard,                  // 신규, shared/guards.ts
    hasPrefixGuard,                         // 신규
    excludedBoardGuard(options.excludedBoardIds), // 신규
  ]
}
```

| 가드 | 판정 | 결과 |
|---|---|---|
| `operatorAlreadyCommentedGuard` | 운영자 계정 중 하나가 댓글을 달았다 | `SKIP 'ALREADY_COMMENTED'`. 댓글 확인 실패는 `RISK 'COMMENT_CHECK_FAILED'`. |
| `authorIsOperatorGuard` | 글쓴이의 `authorId` 또는 `authorNickname`이 운영자 계정에 있다 | `SKIP 'AUTHOR_IS_OPERATOR'` |
| `hasPrefixGuard` | `candidate.prefix !== null` | `SKIP 'HAS_PREFIX'` |
| `excludedBoardGuard` | `candidate.boardId`가 제외 목록에 있다 | `SKIP 'EXCLUDED_BOARD'` |

`SkipReason`에 `'HAS_PREFIX' | 'EXCLUDED_BOARD' | 'AUTHOR_IS_OPERATOR'`가 추가되고, `text.ts`의 건너뜀 사유 문구에 셋이 추가된다(Record라 빠지면 빌드가 깨진다).

`firstPostOnlyGuard`는 넣지 않는다. 한 사람이 말머리 없는 글을 둘 올리면 둘 다 안내를 받는다 — 안내는 글에 대한 것이지 사람에 대한 것이 아니다.

댓글 확인은 `commentCount > 0`인 글만 실제로 읽는다(`CommentAuthorLookup`, 기존). `CHECK_COMMENTS`는 `automationId`를 실어 보내므로 확장에서 일반 글 클라이언트로 간다(§6).

가드 목록은 세션마다 설정에서 다시 만든다. 제외 목록을 고치면 다음 세션부터 적용된다.

## 6. 댓글 경로 — 일반 글

### Phase 0: 계약 캡처

일반 글의 댓글 읽기·쓰기 엔드포인트는 코드베이스에 없다. 메모 게시판(`MemoCommentView.nhn`, `MemoCommentPost.nhn`)은 메모 게시판에만 있다. 구현 첫 작업으로 계약을 확정한다.

- 읽기: `PROBE` 메시지(`scripts/probe.mjs`)로 실제 글 하나의 댓글 응답을 받아 `tests/fixtures/article-comments-*.json`에 저장. 댓글 있음, 댓글 없음, 삭제된 댓글 포함 셋.
- 쓰기: 운영자가 브라우저에서 댓글 하나를 직접 달고 DevTools에서 요청을 캡처한다. URL, 메서드, 폼 필드 또는 JSON 본문, 문자 인코딩, referer, CSRF 토큰 유무, 응답 모양을 적는다. 그 댓글은 운영자가 지운다.
- 결과는 `docs/superpowers/specs/<캡처한 날짜>-cafe-article-comment-contract.md`에 `2026-08-30` 계약 문서와 같은 형식으로 적는다.

캡처 전에는 §6의 나머지를 구현하지 않는다. 계약이 메모 게시판과 다르면(예: JSON 본문, CSRF 토큰 필요) 그 차이는 `articleCafe.ts` 안에 갇히고 앱은 모른다.

### `articleCafe.ts`

`welcome-comment/cafe.ts`와 같은 모양. 순수 함수만 내보낸다.

```ts
commentListUrl(source, postId): string
parseArticleCommentAuthors(body): CommentAuthor[] | null   // 읽기 실패는 null, 댓글 없음은 []
commentWriteRequest(source, postId, content): HttpRequest  // 캡처한 계약 그대로
```

### 확장 라우팅

`background.ts`의 `dispatch`가 `CHECK_COMMENTS`와 `EXECUTE`의 `automationId`로 클라이언트를 고른다.

| `automationId` | 클라이언트 |
|---|---|
| `welcome-comment` | `cafe` (메모 게시판, 기존) |
| `prefix-reminder` | `articleCafe` (신규) |
| 그 외 | `ERROR: UNKNOWN_AUTOMATION` |

`articleCafe.execute`는 메모 게시판과 같은 검증 원칙을 따른다: 쓰기 응답의 본문을 믿지 않고, 댓글을 다시 읽어 우리 `memberKey`가 보여야 `ok`. 없으면 `COMMENT_NOT_VISIBLE`. 로그인 상태(`memberKey`)는 기존 `cafe.checkLogin`이 얻은 것을 함께 쓴다.

`CHECK_LOGIN`, `COLLECT`, `COLLECT_BOARD_PAGE`, `COLLECT_MEMBER_PAGE`, `PROBE`는 바뀌지 않는다.

## 7. 댓글 본문

템플릿이 아니라 자동화 설정의 고정 문구 하나. 변수 없음.

- `renderBody`는 문구를 그대로 `{ ok: true, templateId: null, body }`로 돌려준다.
- 문구가 비어 있으면 `hasTemplate()`이 false → 세션이 `NO_TEMPLATE`으로 거부한다. 대시보드 카드에 이유가 보인다. 가입인사에서 템플릿이 없을 때와 같은 경로.
- 카탈로그 항목의 `panels`는 `['approvals', 'settings']`. 템플릿 패널 없음.

## 8. 스케줄과 제어

### 간격

자동화별 기본 한도를 `PROFILES` 위에 덮는다. 순서는 `PROFILES → 자동화 기본 → DB limits`.

| 프로필 | `sessionIntervalMinMs` | `sessionIntervalMaxMs` |
|---|---|---|
| production | 1.5시간 | 2.5시간 |
| debug | 2분 | 4분 (가입인사와 같음) |

2시간 ± 30분. 고정 2시간이 아닌 이유는 이 코드베이스의 모든 간격과 같다 — 같은 분에 두드리는 것은 기계의 모양이다. 운영 창, 주말 배수, 자정 직후 정산 회차는 `nextSessionStart`가 그대로 준다.

### 제어

트레이와 대시보드의 시작/중지/킬은 하나이고 두 루프를 함께 움직인다. 한쪽만 끄려면 그 자동화 설정의 켜기/끄기를 쓴다 — 이미 있는 스위치다. 꺼진 자동화의 세션은 `DISABLED`로 거부되고 카드가 그렇게 말한다.

`AutomationControl`에서 자동화별이 되는 것: `runOnce(automationId, request)`, `nextRunAt(automationId)`. `AppContext`에서: `lastOutcome(automationId)`, `lastOutcomeAt(automationId)`, `sessionProgress(automationId)`. `main.ts`의 `lastOutcome`이 이미 "가입인사면 반환, 아니면 null"로 자리를 잡아 두었다.

로그인 실패 정지(`onHalt`)는 어느 루프에서 오든 두 루프를 함께 세운다. 로그인은 카페 단위다.

### 세션 겹침

두 루프가 같은 시각을 뽑을 수 있다. 읽기 게이트가 직렬화하므로 뒤의 세션은 앞의 세션이 끝날 때까지 기다린다. 기다리다 운영 창을 벗어나면 그 회차는 `OUTSIDE_ACTIVE_HOURS`로 거부된다 — 게이트는 세션이 열린 시각이 아니라 실제로 네이버에 닿는 시각을 본다. 따로 처리하지 않는다.

## 9. 설정 저장과 화면

### 저장

`automation_settings`에 `options_json TEXT NOT NULL DEFAULT '{}'` 열을 추가하는 마이그레이션 하나. 자동화가 자기 옵션을 넣는 자리이고 판독은 각 모듈이 한다.

```ts
// prefix-reminder/options.ts
interface PrefixReminderOptions {
  readonly commentText: string
  readonly excludedBoardIds: readonly string[]
}
parsePrefixReminderOptions(json: string): PrefixReminderOptions   // 깨진 값은 기본값
```

`boardId` 열은 새 자동화에서 쓰지 않는다. `NOT_CONFIGURED` 판정은 `cafeId`만 본다.

### 초기 제외 목록

운영자가 2026-09-11에 정한 목록. 설정 화면에서 입력하는 값이고 코드에 박지 않는다 — 이 문서는 운영자가 첫 설정 때 옮겨 적을 자리다.

| 게시판 | id |
|---|---|
| 필독 공지 | 147 |
| 중요 공지 | 179 |
| 일반 공지 | 1 |
| 징계 공지 | 165 |
| 가이드 & FAQ | 87 |
| Member of the Month | 207 |

id는 게시판 주소 `cafe.naver.com/f-e/cafes/14538121/menus/<id>`의 마지막 숫자다.

### 설정 이관

`ConfigBundle.automations[]`에 `options: Record<string, unknown>`이 추가된다(`version` 범프). 가져올 때 그대로 `options_json`에 쓴다. 빠지면 이관한 기계에서 문구가 비어 세션이 `NO_TEMPLATE`으로 거부된다. 구버전 번들은 `options`가 없으면 `{}`로 읽는다.

### 화면

- 사이드바: 카탈로그에서 두 번째 항목이 자동으로 생긴다. 라벨 `말머리 안내`(`text.ts` `automation.prefixReminder`).
- 설정 패널: `AutomationSettings.tsx`를 공통부(켜기/끄기, 승인 정책)와 자동화별 섹션으로 나눈다. 자동화별 섹션은 카탈로그 항목이 `settingsSection` 키로 가리키고 렌더러가 그 키로 컴포넌트를 고른다 — `switch`가 아니라 `Record<SettingsSectionKey, Component>`. 가입인사 섹션은 지금의 게시판 id 입력. 새 자동화 섹션은 **댓글 문구**(여러 줄)와 **제외 게시판 id 목록**(한 줄에 하나, 숫자만). 저장 버튼 하나.
- 대시보드: 댓글 작업 카드(`CommentJob`)를 `dashboard.automations`마다 하나씩 그린다. 각 카드에 마지막 결과, 다음 회차, 진행 중 상태, 지금 실행. 시작 미리보기 배너와 날짜 지정 미리보기는 가입인사 카드에만 남는다.
- 승인 패널: 기존 그대로 `automationId`로 동작한다. 항목에 제목·글쓴이가 보인다. 게시판 이름은 `executions`에 없으므로 이번에는 보이지 않는다.

### 이번에 넣지 않는 것

새 자동화의 시작 미리보기(전체 카페를 한 번 더 걷는 비용), 제외 게시판을 이름으로 고르는 UI, 승인 항목의 게시판 이름, 템플릿 변수. 운영 단계라 표면을 최소로 잡는다. 필요해지면 그때.

## 10. 오류 처리

| 상황 | 처리 |
|---|---|
| 전체 목록 읽기 실패 | `collectDay → null` → `COLLECT_FAILED`. 그날은 정산되지 않고 다음 회차가 다시 읽는다. |
| 댓글 목록 읽기 실패 | `RISK 'COMMENT_CHECK_FAILED'` → 정책에 따라 승인 대기 또는 건너뜀. 기존 가드. |
| 쓰기 후 확인 실패 | `COMMENT_NOT_VISIBLE` → `RETRY_WAIT` → 최대 3회. 기존 상태 기계. |
| 문구 미등록 | `NO_TEMPLATE` 거부. 카드에 이유가 보인다. |
| 확장이 모르는 `automationId` | `ERROR: UNKNOWN_AUTOMATION`. `PROTOCOL_VERSION` 범프가 페어링에서 구버전 확장을 거르므로 실제로는 도달하지 않는다. |
| 제외 목록에 숫자 아닌 값 | 저장 시 거부. 화면에 문구. |
| `options_json`이 깨짐 | 기본값(`commentText: ''`, `excludedBoardIds: []`)으로 읽고, 결과적으로 `NO_TEMPLATE` 거부. 조용히 전체 게시판에 댓글을 다는 쪽으로 기울지 않는다. |

## 11. 테스트

기존 구조(`tests/shared`, `tests/desktop`, `tests/extension`, `tests/renderer`)를 따르고 TDD로 간다.

- `shared/automations/prefix-reminder/`: 댓글 파서는 캡처한 픽스처로. 가드는 `Candidate` 표로 — 말머리 있음/없음, 제외 게시판, 운영자 글, 운영자 댓글 있음, 댓글 확인 실패. `articleCafe.ts`의 URL·요청 빌더는 문자열 비교. `options.ts`는 깨진 JSON, 빈 값, 숫자 아닌 id.
- 수집: 가짜 transport로 `COLLECT_BOARD_PAGE` 응답을 흉내내어 "자정 이전 글을 만나면 멈춤", "빈 페이지", "같은 페이지 반복", "읽기 실패 → null", "자정 전 글 잘라냄".
- 오케스트레이터 리팩터링: `orchestrator.test.ts`, `session.test.ts`가 동작 변화 없이 통과. 주입된 `collectDay`를 통해 같은 시나리오를 돌린다.
- 확장: `dispatch`가 `automationId`별로 클라이언트를 고르는지 가짜 http로. 모르는 id는 `ERROR`.
- 부트스트랩: `assertRuntimesRegistered`가 두 id를 요구. 시작/중지가 두 루프를 함께 움직임. `onHalt`가 둘을 함께 세움.
- 렌더러: 카드가 자동화별로 그려짐. 설정 섹션이 키로 갈림. 번들 가져오기가 `options`를 쓰고, 없으면 `{}`.

## 12. 작업 순서

1. **Phase 0**: 일반 글 댓글 읽기·쓰기 계약 캡처 → 계약 문서 + 픽스처.
2. **리팩터링 커밋**: §3의 표. 동작 변화 없음. 기존 테스트 전부 통과.
3. 프로토콜 범프, `RawCandidate.boardId/prefix`, 확장 라우팅, `articleCafe` 클라이언트.
4. `prefix-reminder` 모듈(수집·가드·옵션·렌더) + 카탈로그 등록 + 런타임 조립 + 자동화별 제어.
5. `options_json` 마이그레이션, 설정 API, 설정 패널 분리, 대시보드 카드 자동화별.
6. 설정 이관 번들에 `options` 포함.
7. 릴리스: 프로토콜 범프에 따른 확장 재패키징 (`repackage-after-protocol-bump` 메모).
