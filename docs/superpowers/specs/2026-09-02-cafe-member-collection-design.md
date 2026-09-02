# 카페 회원 목록 수집 설계

- 작성일: 2026-09-02 (KST)
- 대상: 카페 `14538121` 전체 회원 목록을 수집 DB로 옮기고, 글의 작성자와 회원을 `memberKey`로 잇는다
- 전제: [나누어 이어 하는 백필 설계](2026-09-01-resumable-backfill-design.md)의 작업/실행 구분, 페이지 예산, 페이스 규칙을 그대로 쓴다
- 상태: 설계 확정, Phase 0(계약 조사) 전

## 1. 목적

**회원별 활동 분석**이다. 가입일·등급·운영진 여부에 글 작성 이력을 붙여 활동 회원과 휴면 회원, 등급별 글 수 같은 물음에 답한다. 그러려면 글을 쓴 회원만이 아니라 **전체 회원**이 표에 있어야 한다. 글을 한 번도 안 쓴 회원이 휴면 분석의 대상이기 때문이다.

매칭 키는 `memberKey`다. 글 목록의 `writerInfo.memberKey`와 회원 목록의 `memberKey`가 같은 43자 문자열임은 2026-08-23 종단 검증(가입인사 5건 전원 목록에서 찾힘)으로 확인돼 있다([신입회원 판별 설계 §3.4](2026-08-23-new-member-identification-design.md)). 그 설계는 폐기됐지만 실측은 살아 있다.

### 1.1 갱신 정책

**전체를 한 번 옮기고, 이후에는 신규 가입자만 보탠다.** 기존 회원의 등급·닉네임 변화는 쫓지 않는다. 글 수집이 카운터를 그 시점 스냅샷으로 한 번 적고 마는 것과 같은 철학이며, 21만 명을 주기적으로 다시 걷는 비용(매번 약 2,100쪽)을 근거 없이 치르지 않는다.

### 1.2 규모

| 값 | 근거 |
|---|---|
| 전체 회원 약 209,653명 | 2026-08-23 실측 |
| 100건/쪽 → 약 2,100쪽 | `search.perPage=100`이 그대로 먹음(실측) |
| 120분 블록당 약 300쪽 | `collectionDelayMs` 페이스(5~9초, 20회마다 2~5분, 100회마다 10~20분) |
| 기본 스케줄(09~21시, 2시간 일·2시간 휴식)로 블록 7개, 이틀 남짓 | 위 둘의 곱 |

## 2. Phase 0 — 계약 조사

글 목록과 같은 절차([전체글 목록 계약 조사 §7](2026-08-30-cafe-article-list-contract.md))를 회원 목록에 적용한다. **fixture가 닫히기 전에는 파서와 마이그레이션에 들어가지 않는다.**

### 2.1 요청

관리 화면 `ManageWholeMember.nhn`이 실제로 부르는 API는 다음이다(2026-08-23, 공용 스크립트의 `MEMBER_GETLIST` 매핑에서 확정).

```text
GET https://cafe.naver.com/ManageMemberListViewAjax.nhn
  ?search.clubid=14538121&search.searchType=0&search.memberLevel=0
  &search.perPage=100&search.page=<N>&search.sortType=0&search.sortOrder=0
  &search.paginationCached=false&search.totalCountCached=0
```

`sortType=0, sortOrder=0`은 가입일 내림차순이다. 응답은 UTF-8 JSON, `result.members[]`가 회원당 한 건이다.

### 2.2 이미 실측된 것

| 필드 | 값 | 비고 |
|---|---|---|
| `memberKey` | 43자 문자열 | 글의 `writerInfo.memberKey`와 동일 |
| `joinDate` | `2026.08.23.` | KST 날짜만, 시각 없음 |
| `nickname` | 문자열 | HTML 엔티티 아님(0/30) |
| `memberLevelName` | 문자열 | **HTML 엔티티로 인코딩됨**(30/30) |
| `manager`, `staff` | 불리언 | 운영진 여부 |
| `isSuccess` | **JSON 불리언** | 메모 댓글 API의 문자열 `"true"`와 다르다. 파서를 재사용하지 않는다 |

### 2.3 Phase 0가 닫아야 할 미결

1. 화면에 보이는 방문수·최근방문일·글수·댓글수 같은 **활동 카운터가 응답에 있는가**, 있다면 이름과 형식.
2. **마지막 페이지의 종료 신호** — 100건 미만인 페이지인지, 빈 배열인지, 글 API처럼 silent fallback인지.
3. `totalCount`류 필드의 유무와 의미.
4. 같은 `joinDate` 안의 정렬이 **안정적인가** — 같은 페이지를 연속 두 번 읽어 순서를 비교한다. 이어받기와 신규 보태기가 이 위에 선다.
5. 관리자 권한이 없는 세션의 응답 모양 — `isSuccess:false`인지, 로그인 페이지 HTML인지.

### 2.4 캡처 도구

`scripts/capture-cafe-members.mjs`(새 파일)는 §2.1의 URL 한 종류만 허용하고, page 번호만 인자로 받는다. URL 상수·허용 판정은 `src/shared/cafeMemberFixture.ts`에 둔다. 정제는 기존 `sanitizeCafeArticleFixture`를 그대로 쓴다 — `memberkey`·`nickname`을 같은 값은 같은 가명으로, 길이를 유지해 치환하는 규칙이 이미 있다. raw 본문은 메모리에서만 다루고 파일은 `0600`·create-only로 쓴다.

캡처할 fixture: page 1, 중간 page(예: 1000), 마지막 page, 마지막을 넘긴 page, 그리고 가능하면 권한 없는 세션의 오류 envelope.

정제기는 글 목록용을 재사용하지 않고 회원 목록 전용 allowlist를 쓴다(구현 리뷰에서 뒤집힘 — 관리자 API는 `realName`·`sex`·`ageGroup`처럼 글 목록에 없는 개인정보를 돌려주므로, 아는 이름만 지우는 denylist는 못 믿는다). 파서가 읽는 여섯 키만 남기고 `memberKey`·`nickname`은 가명으로, 나머지 문자열은 길이만 남긴 표식으로 바꾼다. envelope와 `pageOption`의 숫자·불리언만 그대로 둔다.

### 2.5 실측 결과 — 2026-09-03

page 1·1000·2096·2097·2098·2200을 실제 세션으로 떠서 §2.3을 닫았다. 정제본은 `tests/fixtures/cafe-member-list-page-*.json`에 있다.

**응답 모양.** `{ isSuccess, result: { clubid, realNameCafe, totalCount, pageOption, members[] } }`. `result.totalCount`는 **그 페이지의 건수**(100, 13, 1)이지 카페 전체가 아니다. 전체는 `result.pageOption.totalCount`이고, 그 옆에 `endPage`·`page`·`perPage`·`exceedCountLimit`이 있다. 회원 항목은 파서가 읽는 여섯 키 외에 `articleCount`·`commentCount`·`visitCount`·`lastVisitDate`·`memberLevel`(숫자)·`memberLevelIconId`·`activityStop`·`memberTag`·`maskedMemberId`·`realName`·`sex`·`ageGroup`·프로필 이미지 URL 둘을 더 갖는다. `memberLevelName`은 HTML 엔티티로 인코딩돼 온다(`&#48708;&#51648;&#53552;` = 비지터). `joinDate`는 `2026.09.02.` 형식이다.

§2.3의 답:

1. **활동 카운터는 있다** — `articleCount`, `commentCount`, `visitCount`(숫자), `lastVisitDate`(문자열). **저장하지 않는다** — 2026-09-03 결정. 이 DB의 목적은 글과 회원의 `memberKey` 매칭이지 회원별 활동 추적이 아니며, 활동 데이터를 보관하면 지켜야 할 것이 늘 뿐 매칭에는 보태는 것이 없다. 정제기 allowlist에도 넣지 않는다.
2. **종료 신호는 짧은 페이지다.** 실측 당시 `endPage`는 2096이었지만 2096은 100명으로 꽉 차 있었고 2097에 13명이 더 있었다(2007년 10월, 겹침 없음). 즉 `endPage`도 `totalCount`도 정확한 끝이 아니다. **끝을 넘긴 요청(2098, 2200)은 빈 배열도, 글 API 같은 1페이지 폴백도 아닌 마지막 회원 한 명짜리 페이지**를 `isSuccess:true`로 돌려준다. 걷기는 2097의 짧은 페이지에서 끝나므로 이 응답을 보통 만나지 않고, 마지막 페이지가 마침 100명으로 꽉 차서 만나더라도 꼬리 회원이 그대로 나타나 슬라이스가 비고 짧은 페이지로 종료된다. §8의 silent-fallback 가드는 그래도 남긴다 — 다른 방향의 오답에 대한 보험이다.
3. **`pageOption.totalCount`는 대략치다.** 209,584라고 했지만 실제로는 209,613명 이상이 걸어졌다. 진행률 분모로만 쓰고 종료 판단에는 쓰지 않는다. `total_member_count`는 이 값으로 채운다.
4. **같은 `joinDate` 안의 정렬은 안정적이다.** page 1000을 1분 간격으로 두 번 읽어 100명의 순서가 동일했고(2024-05-22 91명 + 05-21 9명), page 1도 3분 간격으로 동일했다. 이어받기와 신규 보태기의 전제가 선다.
5. **권한 없는 세션은 뜨지 못했다.** 관리자가 아닌 세션이 없었다. 코드는 `isSuccess:false`와 HTML 응답 모두를 `MEMBER_PAGE_FORBIDDEN`으로 다루며, 실측은 열어 둔다.

덤으로 하루 가입이 100명을 넘는 날이 있다 — page 1의 100명 전원이 2026-09-02 가입이었다. §1.2의 "하루 100명 안팎"은 평균이지 상한이 아니므로, 신규 보태기는 첫 페이지가 전부 새 회원이면 다음 페이지로 이어져야 하고 실제로 그렇게 짜여 있다(§4.3).

## 3. 데이터 모델

같은 PostgreSQL 수집 DB에 **회원용 표 셋을 새로 둔다.** 기존 `runs`·`feed_state`는 `(feed_kind, menu_id)`가 정체성인데 회원 목록은 게시판이 없다. 빈 문자열 같은 자리표시 `menu_id`를 넣어 재사용하지 않는다. 스키마는 `src/desktop/collection-db/memberSchema.ts`에 분리하고 마이그레이션은 `drizzle-collection`에 추가한다.

### 3.1 `members`

| 열 | 형 | 비고 |
|---|---|---|
| `member_key` | text PK | 원본 키. 내보내기 코드는 반드시 익명화 |
| `nickname` | text | |
| `join_date` | date | KST 날짜. `YYYY.MM.DD.`를 파싱 |
| `level_name` | text | 엔티티 해제 후 |
| `is_manager`, `is_staff` | boolean not null | |
| (카운터) | bigint nullable | §2.3-1에서 확인된 것만. 음수 거부 check |
| `snapshot_at` | timestamptz(3) not null | 카운터를 읽은 시각, 데스크톱 시계 |
| `first_seen_at` | timestamptz(3) not null | |
| `last_run_id` | uuid → `member_runs.id` | |

인덱스: `join_date`, `level_name`.

### 3.2 `member_feed_state`

카페당 DB이므로 **한 행**이다. `id integer PK check (id = 1)`.

| 열 | 비고 |
|---|---|
| `state_version` | CAS용 |
| `anchor_member_key`, `anchor_join_date`, `reference_page` | 마지막으로 커밋한 페이지의 꼬리 회원. 커서 |
| `page_identity` | 커밋한 페이지의 identity |
| `total_member_count` | 걷기 시작 시점 값(§2.3-3이 있으면). 진행률 분모 |
| `completed_at` | 마지막 페이지에 닿은 시각. null이면 걷기 미완 |
| `topped_up_at` | 마지막 신규 보태기가 끝난 시각 |
| `forced_at` | 운영 시간 무시 요청 시각. 백필 설계와 같은 의미 |
| `updated_at` | |

### 3.3 `member_runs`

`runs`와 같은 꼴이다. `run_kind`는 `backfill`(전체 걷기 시작), `incremental`(이어받기), `topup`(신규 보태기). status·stop_reason·페이지 카운터·건수 카운터·`last_committed_page`는 동일하며 running 행 유일 부분 인덱스도 같다.

### 3.4 매칭

별도 매핑 표를 두지 않는다. `posts.author_id = members.member_key` join이 매칭이다. 표를 하나 더 두면 두 표가 어긋날 자리만 하나 더 생긴다. 상태 화면의 "글 작성자 N명 중 M명이 회원표에 있음"(§6)이 이 join의 건강 지표이며, 비율이 낮아지면 키 계약이 바뀐 것이다.

## 4. 걷기

### 4.1 전체 걷기

page 1부터 오름차순으로 읽는다. 목록이 가입일 내림차순이라 걷는 동안 신규 가입자가 위에 끼어들고 모든 페이지가 아래로 밀린다 — 하루 약 100명이면 약 1쪽이다.

**연속성** 규칙은 글 수집과 같다. 앞 페이지 꼬리의 `member_key`가 다음 페이지에 보이면 그 다음부터 저장하고, 안 보이면 앞 페이지를 되감아 읽는다. 되감은 페이지의 identity가 같으면 밀리지 않은 것이고, 꼬리 키가 다른 위치에 있으면 그 뒤부터 다시 잇고, 없으면 §4.2의 재탐색을 한다.

**저장**은 페이지 단위 한 트랜잭션이다(CAS: `state_version`이 기대와 다르면 `conflict`, run을 `partial`로 끝내고 다음 실행이 커서에서 다시 자리를 찾는다). 같은 회원을 다시 읽으면 upsert가 닉네임·등급·운영진 여부·카운터·`snapshot_at`을 덮고 `first_seen_at`은 유지한다.

**종료**는 §2.3-2가 확정한 신호다. 닿으면 `completed_at`을 적고 run을 `succeeded`로 끝낸다. 예산 소진은 `partial`/`PAGE_BUDGET_SPENT`, 중지는 `interrupted`/`ABORTED`, 형식 오류·연결 끊김은 `failed`/오류 코드이며 셋 모두 커서를 유지한다(백필 설계 §4).

### 4.2 이어받기

커서는 `anchor_member_key + anchor_join_date + reference_page`다. `join_date`가 날짜 단위라 시각 비교는 못 하지만 페이지가 대략 하루치라 상관없다.

1. `reference_page`를 읽는다. 앵커 키가 있으면 그 다음부터 잇는다.
2. 없으면 페이지의 가입일 범위와 앵커 가입일을 비교한다. 페이지가 앵커보다 최신이면(가입일이 더 큼) 다음 페이지로, 오래됐으면 이전 페이지로 한 쪽씩 옮긴다.
3. 앵커 가입일이 범위 안에 있는 페이지에서 앵커 키를 찾으면 그 다음부터, 끝내 없으면(탈퇴) 같은 가입일의 마지막 회원 다음부터 잇는다.

며칠 뒤 재개해도 밀린 쪽 수는 며칠 분이므로 재탐색은 몇 쪽이다. 탐색 페이지는 `probe`로 세어 저장 페이지와 구분한다.

### 4.3 신규 보태기(top-up)

`completed_at`이 찍힌 뒤에는 **KST 하루 한 번**, 비트가 본 작업을 시작하기 전에 page 1부터 읽는다. 한 페이지의 100건이 **모두 이미 아는 키**이면 멈춘다. 상한 5쪽이며 같은 페이지 예산에서 차감한다. run은 `topup`으로 남고 `topped_up_at`을 갱신한다.

이 경로는 신규 가입자만 넣는다. 이미 아는 회원이 페이지에 섞여 있어도 upsert가 카운터를 덮지만 그것은 부수 효과이지 목적이 아니다.

### 4.4 페이스

`collectionDelayMs`를 그대로 쓴다. 회원 목록이라고 더 빨리 읽을 이유가 없고, 관리 화면 API는 오히려 더 조심할 대상이다.

## 5. 루프 통합

지금 `collectionLoop`는 feed 하나의 상태를 읽어 미완이면 러너를 시작한다. 이를 **작업 목록**을 받는 꼴로 넓힌다.

```ts
// src/desktop/collectionJob.ts
interface CollectionJob {
  readonly name: 'articles' | 'members'
  readProgress(): Promise<{ exists: boolean; complete: boolean; forced: boolean }>
  start(maxPages: number): CollectionStartResult
}
```

글 작업과 회원 작업이 각각 이를 구현한다. 비트는 다음 순서다.

1. 회원 걷기가 완료돼 있고 오늘(KST) 아직 top-up이 없었으면 top-up을 먼저 돌린다(§4.3).
2. 미완 작업들 가운데 **지난 비트 다음 것부터 라운드로빈**으로 하나를 시작한다. 미완이 하나면 그것만 돈다.

한 비트에 한 작업만 굴리므로 브라우저 세션은 한 번에 한 갈래만 쓴다. 두 러너가 공유하는 잠금 하나(`collectionLock.ts`)가 동시 실행을 막고, 가입인사 세션이 브라우저를 쓰는 동안 기다리는 `isSessionBusy` 규칙은 그대로 적용된다. `forced`는 작업별 값이며 어느 하나라도 강제면 루프는 운영 시간 밖에도 깬다.

작업 생성은 사람만 한다는 규칙(비트는 미완 작업을 잇기만 한다)은 유지한다. 회원 걷기는 상태 화면의 시작 버튼이 만든다.

## 6. 프로토콜과 확장

`PROBE`는 진단용이므로 재사용하지 않는다. 한 쌍을 추가한다.

```ts
// AppMessage
| { type: 'COLLECT_MEMBER_PAGE'; requestId: string; cafeId: '14538121'; page: number; perPage: 100 }
// ExtensionMessage
| { type: 'MEMBER_PAGE_COLLECTED'; requestId: string; page: number; result: CollectedMemberPage }
```

확장의 `memberPageReader.ts`(새 파일)는 `boardPageReader`와 같은 꼴로 한 페이지만 읽고 `MEMBER_PAGE_BAD_REQUEST | NETWORK_ERROR | HTTP_ERROR | INVALID_JSON | PARSE_ERROR | FORBIDDEN`을 돌려준다. 페이지 넘김·커서·휴지·저장은 데스크톱이 갖는다.

파서 `src/shared/cafeMemberList.ts`는 글 파서와 같은 엄격함이다. `isSuccess !== true`, `result.members`가 배열 아님, `memberKey` 비문자열, `joinDate`가 `YYYY.MM.DD.` 아님, 불리언 자리에 불리언 아님은 **페이지 전체 거부**다. `memberLevelName`은 엔티티를 해제한다. `page_identity`는 정렬한 `memberKey`를 NUL로 이어 붙인 문자열의 FNV-1a 64-bit(`member-page-v1\0` 접두)다.

`PROTOCOL_VERSION`이 올라간다. **릴리스 앱을 재패키징하지 않으면 페어링이 조용히 깨진다.**

## 7. 화면

설정 화면에는 새 항목이 없다. 스케줄·예산은 글 수집과 공유한다.

상태 화면에 카드 하나가 는다 — "회원 목록".

- 시작 버튼(걷기 미시작일 때), 중지 버튼(실행 중일 때), 운영 시간 무시 스위치(백필과 같은 의미)
- 진행률: 읽은 쪽 / `total_member_count`÷100(분모를 모르면 읽은 쪽 수만)
- 저장 회원 수, 완료 시각, 마지막 신규 보태기 시각
- 매칭 지표: "글 작성자 N명 중 M명이 회원표에 있음"

새 문구는 전부 `src/shared/text.ts`에 둔다. 시각은 KST로만 보인다.

## 8. 오류와 안전

- 관리자 권한 없는 세션(`isSuccess:false` 또는 HTML 응답)은 `MEMBER_PAGE_FORBIDDEN`으로 run을 `failed`로 끝내고 커서를 유지한다. 다음 비트가 다시 시도하되, 상태 화면이 이유를 이름으로 보여준다.
- silent fallback이 있다면(§2.3-2) 글과 같은 `page_identity`+`reference_page` 모순 검사로 잡고 `MEMBER_PAGE_SILENT_FALLBACK`으로 끝낸다.
- 회원 표는 닉네임을 담는다. `configTransfer`(설정 내보내기)의 대상이 아니며, 어떤 로그·오류 메시지에도 `member_key`·닉네임을 쓰지 않는다. 실패 진단은 필드 이름과 형만 남긴다.
- `joinDate`는 KST 날짜 문자열이다. 비교는 날짜 단위로만 하고 시각 비교를 흉내 내지 않는다.

## 9. 모듈 배치

전부 새 파일이며, 기존 파일은 루프(작업 목록화)·프로토콜(메시지 추가)·상태 화면(카드 추가)·`text.ts`만 손댄다.

| 파일 | 책임 |
|---|---|
| `src/shared/cafeMemberFixture.ts` | URL 상수, 캡처 허용 판정 |
| `src/shared/cafeMemberList.ts` | 파서, `CollectedMemberPage`, identity |
| `src/extension/memberPageReader.ts` | 한 페이지 읽기 |
| `src/desktop/collection-db/memberSchema.ts` | 표 셋 |
| `src/desktop/collection-db/memberRepository.ts` | 원자적 페이지 저장(CAS), run 기록, 커서 |
| `src/desktop/collection-db/memberStatusQuery.ts` | 화면 질의, 매칭 지표 |
| `src/desktop/memberCollectionOrchestrator.ts` | 걷기·연속성·종료 |
| `src/desktop/memberCollectionResume.ts` | 이어받기 재탐색 |
| `src/desktop/memberCollectionRunner.ts` | 시작·중지·잠금 |
| `src/desktop/collectionJob.ts`, `collectionLock.ts` | 작업 추상, 잠금 |
| `scripts/capture-cafe-members.mjs` | Phase 0 캡처 |

## 10. 테스트

| 대상 | 내용 |
|---|---|
| `tests/fixtures/cafe-member-list-page-*.json` | 정제본 4~5장 |
| `tests/shared/cafeMemberList.test.ts` | 정상, 엔티티 해제, `isSuccess:false`, 형식 오류마다 페이지 거부, identity 결정성 |
| `tests/extension/memberPageReader.test.ts` | 오류 코드 매핑 |
| `tests/desktop/memberCollectionOrchestrator.test.ts` | 가짜 fetcher로 걷는 도중 신규 가입자 삽입 → 밀림·되감기, 예산 소진, 중지, 마지막 페이지 종료, CAS 충돌 |
| `tests/desktop/memberCollectionResume.test.ts` | 앵커 재탐색 앞·뒤 이동, 탈퇴한 앵커 |
| `tests/desktop/collectionLoop.test.ts` | 라운드로빈, 미완 하나만 남을 때, top-up 하루 한 번, 잠금 |
| `scripts/run-collection-integration.mjs` | 회원 표 upsert·CAS·한 행 제약 케이스 추가 |

## 11. 다루지 않는 것

- **기존 회원의 등급·닉네임 갱신.** 필요해지면 "전체 재순회"를 별도 작업 종류로 붙인다.
- **탈퇴 표시.** top-up은 신규만 보므로 탈퇴는 알 수 없다. 글 목록의 `writerInfo.secedeMember`가 글 단위로는 답한다.
- **단건 조회 폴백.** `ManageMemberDetailInfoViewAjax.nhn`은 존재만 확인됐다.
- **분석 질의 자체.** 이 설계는 표를 채우고 join이 성립하게 하는 데서 끝난다. 활동/휴면 같은 질의는 표가 찬 뒤 실제 물음에 맞춰 따로 정한다.
