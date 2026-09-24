# 검색어로 게시판의 한계 너머를 보충하는 설계

- 작성일: 2026-09-25 (KST)
- 대상: 게시판별 백필(설계 `2026-09-05-per-board-collection-design.md`)이 `FEED_HORIZON`에서 멈춘 게시판
- 상태: 설계 확정, 구현 전

## 1. 왜 필요한가

게시판 목록은 게시판마다 **1000쪽(50건/쪽)** 까지만 준다. 2026-09-19 13:00 실행이 국내구입기(137) 1000쪽을 저장하고 `partial` · `FEED_HORIZON`으로 멈췄다. 2026-09-25 DB 기준:

| 게시판 | 저장 글 | 가장 오래된 글 |
|---|---|---|
| 137 국내구입기 & 정보 | 50,724 | **2025-08-29** |
| 그 밖의 수집 게시판 | — | 2025-01-01 |

한계에 닿은 게시판은 137 하나다. 빠진 구간은 2025-01-01 ~ 2025-08-28.

### 빠진 양

카페 글 id는 카페 전체에서 하나씩 오른다. 137까지 완전한 2025-09 ~ 11 구간에서도 id의 **6.7%** 는 비어 있다(삭제된 글과 수집하지 않는 게시판, 메모리 `collected-boards-not-whole-cafe`). 빈 구간은 id 111,973개 중 41,545개가 비어 있다. 기준선 6.7%(약 7,500)를 빼면 **137에서 빠진 글은 약 3만 4천 건**이다. 2025-09 한 달 137 글이 4,246건이었던 것과도 맞는다.

### 카페가 주는 다른 길

게시판 안 제목 검색은 기간을 받는다.

```
https://cafe.naver.com/f-e/cafes/14538121/menus/137?ta=SUBJECT&from=20250101&to=20250901&q=이마트&page=1&size=50
```

운영자가 2026-09-25 직접 잰 사실:

| 확인 | 결과 |
|---|---|
| 검색어 없이 기간만 (`q` 없음, `q=` 빈 값) | 안 된다 |
| 한 글자 검색어 | 그 글자가 들어간 글이 빠진다. 부분 문자열 일치가 아니다 |
| `구매` | `구매했습니다`까지 잡는다. `이마트 구매`는 `이마트` + `구매` 두 어절이다 |
| `글렌` | `글렌알라키`까지 잡는다 |
| 결과가 많은 검색어의 쪽 한계 | 없다. 끝까지 다 나온다 |

즉 **어절이 검색어로 시작하면 걸린다.** 검색어 하나로는 게시판 전체를 덮지 못하지만, 이미 가진 제목에서 많이 쓰인 어절을 골라 합집합을 쌓으면 대부분을 덮는다.

## 2. 무엇이 바뀌지 않는가

- 글 작업(`feed_state`, 전체글·게시판별 범위, "작업은 하나뿐" 규칙). 검색 보충은 **별도 작업**이다.
- `posts` 테이블과 upsert. 같은 글이 여러 검색어나 피드에서 와도 한 행이다.
- 수집 루프, 페이싱, 블록 예산, 잠금, 세션 양보.
- 기존 `COLLECT_BOARD_PAGE` 요청과 목록 파서.

## 3. 구조

### 새 작업 `boardSearch`

`CollectionJob`의 새 구현(`src/desktop/boardSearchJob.ts`)이다. 루프가 `articles`, `members`, `memberResync`와 번갈아 돌린다. 회원 재동기화가 자기 테이블과 커서를 가진 것과 같은 모양이다. 글 작업과 **동시에 존재**하므로, 보충이 며칠 걸려도 그날그날의 수집이 멈추지 않는다.

`CollectionJob.name`에 `'boardSearch'`를 더하고 `bootstrap.ts`의 `jobs`에 한 줄을 더한다.

### 새 테이블 `board_search_state`

검색어 하나가 한 행이다.

| 열 | 타입 | 뜻 |
|---|---|---|
| `board_id` | text, FK `boards` | 대상 게시판 |
| `query` | text | 검색어 |
| `from_day` | text `yyyymmdd` | 빈 구간 시작, KST, 포함 |
| `to_day` | text `yyyymmdd` | 빈 구간 끝, KST, 포함 |
| `queue_order` | integer ≥ 1 | 사전이 고른 순서. 작업을 만들 때 고정 |
| `expected_gain` | integer ≥ 0 | 사전이 예측한 신규 몫(원천 기준 글 수) |
| `last_committed_page` | integer, null | 마지막으로 저장한 쪽 |
| `inserted_count` | integer ≥ 0 | 이 검색어가 새로 넣은 글 수 |
| `last_run_id` | uuid, FK `runs` | |
| `completed_at` | timestamp | 끝까지 걸은 때 |
| `updated_at` | timestamp | |

- PK `(board_id, query)`. 체크: `from_day <= to_day`, `queue_order >= 1`.
- 행은 모두 같은 `board_id`, `from_day`, `to_day`를 갖는다. 작업은 하나뿐이며, 새로 만들면 모든 행을 교체한다. running 실행이 있으면 교체를 거절한다(`replaceJob`과 같다).
- 작업이 **존재**한다 = 행이 있다. **완료**다 = 모든 행에 `completed_at`이 있다.

`runs`에는 검색어마다 한 행을 남긴다. `collection_feed_kind`에 `board_search`를 더하고, `menu_id`는 게시판, 검색어는 새 열 `runs.search_query`(text, null)에 적는다.

### 커서는 쪽 번호다

`to_day`가 과거로 고정되어 있어 결과 목록 앞에 새 글이 끼어들지 않는다. 전체글 피드의 앵커 재배치(`collectionResume.ts`)가 필요 없다.

도중에 구간 안의 글이 삭제되면 결과가 앞으로 당겨져 한 쪽 경계의 글을 건너뛸 수 있다. 그래서 재개는 `last_committed_page`를 **다시 읽고** 그다음 쪽으로 간다. upsert라 겹쳐 읽어도 안전하다. 한 블록 안에서 이어 걷는 동안에는 다시 읽지 않는다.

### 작업의 생애

1. 운영자가 게시판과 시작일을 고른다(137, 2025-01-01).
2. `to_day` = 그 게시판에 저장된 가장 오래된 글의 KST 날짜(137이면 20250829). 그날은 겹쳐 읽는다.
3. 사전(§4)이 그 게시판 제목에서 검색어와 순서를 정해 행을 만든다.
4. 블록마다 미완료 검색어를 순서대로 걷는다(§6).
5. 모든 행이 완료되면 끝이다. 루프는 완료된 작업을 다시 걷지 않는다.

## 4. 검색어 사전

`src/shared/boardSearchDictionary.ts`. 순수 함수다. DB와 네트워크를 모른다. 입력은 제목 목록, 출력은 `{ query, expectedGain }`의 순서 있는 목록이다.

1. **원천**: 그 게시판에 저장된 글 전부의 `title`. 말머리(`prefix`)는 넣지 않는다. 검색 대상이 `SUBJECT`다.
2. **어절 분리**: 소문자로 바꾸고 `[^0-9a-z가-힣]+`로 나눈다. 빈 조각은 버린다.
3. **후보**: 두 글자 이상 어절 중 등장 글 수 상위 4,000개. 실제로 쓰인 온전한 어절만 후보다. `이마`처럼 어절의 조각은 후보가 아니다.
4. **매칭 모델**: 제목의 어느 어절이 후보로 **시작**하면 그 글은 걸린다(§1 실측).
5. **선택**: 탐욕법. 매 단계 아직 덮이지 않은 글을 가장 많이 덮는 후보를 고르고, 그 수를 `expectedGain`에 적는다.
6. **멈춤**: K개에 이르거나 다음 후보의 `expectedGain`이 최소치 아래면 멈춘다. `BOARD_SEARCH_QUERY_LIMIT = 300`, `BOARD_SEARCH_MIN_GAIN = 5`. 상수로 두고 화면에 내지 않는다(운영 단계, 메모리 `operations-phase-from-2026-09-01`).
7. **결정성**: 같은 입력이면 같은 출력. 기여가 같으면 등장 글 수가 많은 쪽, 그다음 코드 단위 순서가 앞선 쪽.

### 137에 대한 예측

최근 글(2025-12 이후)로 사전을 만들고, 사전에 쓰지 않은 가장 오래된 구간(2025-08-29 ~ 11, 13,988건)에서 쟀다. 요청 쪽은 빈 구간 3만 건 기준으로, 결과 행을 50으로 나누고 검색어마다 끝 쪽 하나를 더한 값이다.

| K | 커버리지 | 결과 행 / 빈 구간 | 요청 쪽 |
|---|---|---|---|
| 50 | 86.8% | 1.6배 | ~1,000 |
| 100 | 92.0% | 2.0배 | ~1,200 |
| 300 | **97.0%** | 2.6배 | ~1,700 |
| 500 | 98.0% | 2.9배 | ~2,000 |

같은 데이터로 만들고 잰 값과 홀드아웃 값이 1%p 안에서 같다. 최근 제목의 사전이 과거 구간에도 통한다. 앞 순서는 `글렌, 구매, 구입, 이마트, gs, 트레이더스, 위스키, 12, 조니, 홈플, 와인, 코스트코, cu, 10, 롯데…`이다.

검색어 하나의 최대 결과는 빈 구간에서 약 4,200건(85쪽)이다. 검색 결과에는 쪽 한계가 없다(§1).

블록당 약 150쪽, 하루 3블록이면 K=300은 **4일 남짓**이다.

### 닿지 않는 꼬리

약 3%는 어느 흔한 어절로도 시작하지 않는 제목이다(`득탬?`, `신나네여`, `생존신고!`). 이 설계는 그것을 쫓지 않는다. 남은 양은 §7의 잔여 추정으로 보인다.

## 5. 프로토콜과 확장

### 새 요청 `COLLECT_BOARD_SEARCH_PAGE`

```ts
export interface CollectBoardSearchPageRequest {
  readonly type: 'COLLECT_BOARD_SEARCH_PAGE'
  readonly requestId: string
  readonly cafeId: typeof CAFE_ARTICLE_LIST.cafeId
  /** Digits and never '0': a search is scoped to one board. */
  readonly menuId: string
  /** 2–40 characters after trimming, no control characters. */
  readonly query: string
  /** KST calendar day, yyyymmdd, inclusive. */
  readonly fromDay: string
  /** KST calendar day, yyyymmdd, inclusive, not before fromDay. */
  readonly toDay: string
  readonly page: number
  readonly pageSize: typeof CAFE_ARTICLE_LIST.pageSize
}
```

- 검증은 `protocol.ts`의 `isCollectBoardSearchPageRequest`. 거절: 메뉴 `'0'`, 숫자 아닌 메뉴, 검색어 길이·제어문자, 날짜 형식, `fromDay > toDay`, 쪽 < 1.
- `fromDay`/`toDay`는 데스크톱이 `kst.ts`로만 만든다. `KST_OFFSET_MS` 밖의 시간대 계산을 들이지 않는다.
- `PROTOCOL_VERSION` 11 → 12. 앱과 확장을 함께 다시 패키징한다(메모리 `repackage-after-protocol-bump`).

### 확장

- `src/extension/cafeBoardSearchEndpoint.ts`: 검색 API URL을 만들고 알아본다. 카페 id와 경로는 상수, 게시판·검색어·날짜·쪽만 변수다. `cafeArticleFixture.ts`의 "이 엔드포인트만" 제약과 같다.
- `src/extension/boardSearchPageReader.ts`: 한 쪽만 읽는다. 루프·커서·대기·저장 정책이 없다(`boardPageReader`와 같은 계약). 실패 코드 `BOARD_SEARCH_BAD_REQUEST | _NETWORK_ERROR | _HTTP_ERROR | _INVALID_JSON | _PARSE_ERROR`.

### 응답 계약

`src/shared/cafeBoardSearchList.ts`. 결과는 `CollectedArticlePage`(`items`, `pageInfo`, `pageIdentity`)로 낸다. `posts` upsert가 받는 타입은 `CollectedPostMetadata` 하나뿐이다.

검색 API의 요청 URL과 응답 JSON은 **아직 캡처하지 않았다.** 구현의 첫 단계가 캡처다(§9).

- 항목이 게시판 목록과 같은 모양(`articleList[].item`)이면 `cafeArticleList.ts`의 항목 파서를 내보내 재사용하고, 봉투와 쪽 정보만 새로 파싱한다.
- 다르면 `2026-08-30-cafe-article-list-contract.md`처럼 계약 문서를 따로 쓰고 `CollectedPostMetadata`로 옮긴다.
- 어느 쪽이든 필드가 빠지거나 형식이 어긋나면 크게 실패한다. 로그인 화면이나 HTML을 빈 결과로 읽지 않는다.

## 6. 걷기

### 러너

`src/desktop/boardSearchRunner.ts`. `start`는 즉시 돌아오고, 블록 안의 순차 루프가 미완료 검색어를 `queue_order` 순으로 걷는다.

- 페이지 예산은 블록 전체가 공유한다. 검색어 하나가 끝나면 남은 예산으로 다음을 잇는다.
- 검색어마다 `runs` 한 행.
- 예산이 다하면 그 검색어는 `partial` · `PAGE_BUDGET_SPENT`, 다음 블록이 이어 간다.
- 한 검색어가 `failed`로 끝나면 **다음 검색어로 간다.** 다음 블록이 실패한 것을 다시 시도한다.
- 중지 요청은 쪽 경계에서 지금 검색어를 `interrupted`로 끝내고 다음으로 가지 않는다.
- 잠금(`collectionLock`), 세션 양보(`isSessionBusy`), 페이싱 대기, 시계는 기존 러너와 같은 의존성을 주입받는다.
- 쪽 하나의 저장은 한 트랜잭션이다: `posts` upsert, `board_search_state.last_committed_page`·`inserted_count`, `runs` 카운터.

### 끝 판정

| 관찰 | 판정 |
|---|---|
| 항목 0건 | 끝 → `succeeded`, `completed_at` |
| 직전 쪽과 `pageIdentity`가 같다(끝을 넘겨 되돌아옴) | 끝 → `succeeded`. 그 쪽은 이미 저장했다 |
| 쪽 정보가 다음이 없다고 말한다 | 그 쪽을 저장하고 끝 |
| 항목의 `boardId` ≠ 대상 게시판 | `failed` · `BOARD_SEARCH_WRONG_BOARD`, 그 쪽은 저장하지 않는다 |
| 항목의 `postedAt`이 KST로 [`from_day`, `to_day`] 밖 | `failed` · `BOARD_SEARCH_OUT_OF_WINDOW`, 그 쪽은 저장하지 않는다 |

마지막 두 줄은 검색 필터가 조용히 풀렸을 때 다른 게시판 글이나 기간 밖 글이 보충으로 섞이지 않게 한다. 실패해도 커서는 움직이지 않는다.

끝을 넘긴 요청에 무엇이 오는지는 캡처(§9)로 확정하고, 표의 첫 세 줄 중 실제로 일어나는 것만 구현한다.

## 7. 화면

수집 메뉴에 독립 카드 `src/renderer/views/collection/BoardSearchCard.tsx`를 둔다.

- **만들기**: 게시판(수집 대상 게시판 중 선택)과 시작일. 끝은 "저장된 가장 오래된 글 {날짜}"로 자동 표시한다. 만들기 전에 사전을 계산해 "검색어 {K}개, 예상 약 {쪽}쪽"을 보인다. 이미 작업이 있으면 교체 확인을 띄운다.
- **진행**: 요약 한 줄(완료 n / K, 지금 걷는 검색어, 새로 넣은 글 누계) 아래에 검색어 표(순서, 검색어, 상태, 쪽, 새 글 수, 예측 기여).
- **잔여 추정**: "빈 구간 id {span}개 중 비어 있는 것 {b}. 기준선 {c}%(삭제·비수집 게시판)를 빼면 아직 못 거둔 글 약 {b − c×span}건". 기준선은 그 게시판이 완전한 직후 3개월(`to_day` 다음날부터)의 빈 id 비율이다. 2026-09-25 137 기준으로 {span} 111,973, {b} 41,545, {c} 6.7%, 잔여 약 34,000이다. `src/desktop/collection-db/boardSearchCoverageQuery.ts`가 계산하고 `idGapQuery`처럼 지문으로 캐시한다.

문구는 모두 `src/shared/text.ts`. 시각·날짜는 KST로만 보인다.

## 8. 옮기는 절차

1. 앱과 확장을 새로 패키징한다(프로토콜 12).
2. 앱을 끄고 마이그레이션을 적용한다(메모리 `collection-migration-before-app`):
   ```bash
   COLLECTION_MIGRATION_DATABASE_URL=postgresql://lp2k@127.0.0.1:5432/whisky_manager_collection pnpm db:collection:migrate
   ```
   추가되는 것: `board_search_state` 테이블, `collection_feed_kind`의 `board_search`, `runs.search_query`.
3. 새 패키지를 띄우고 확장을 다시 불러온다.
4. 수집 메뉴의 검색 보충 카드에서 137, 2025-01-01로 작업을 만든다.
5. 예약이 켜져 있으면 다음 블록부터 글 작업·회원 작업과 번갈아 걷는다.

## 9. 구현 순서의 첫 단계: 계약 캡처

코드보다 먼저 한다.

1. 로그인된 브라우저에서 §1의 검색 페이지가 부르는 `apis.naver.com` 요청 URL과 응답 JSON을 픽스처로 저장한다(`docs/superpowers/specs/examples/`).
2. 마지막 쪽 +1을 요청했을 때의 응답도 저장한다. §6 끝 판정 표를 확정한다.
3. (선택) 137이 완전한 2025-09를 `from/to`로 걸고 검색어 두세 개의 결과 건수를 DB의 예측(§4 매칭 모델)과 대조한다.

## 10. 테스트

- `boardSearchDictionary`: 탐욕 선택 순서, 동점 규칙, K와 최소 기여 멈춤, 어절 분리(기호·이모지·영숫자 혼합), 조각이 후보가 되지 않음, 결정성.
- `cafeBoardSearchList`: 캡처 픽스처 파싱, 봉투·항목·쪽 정보의 형식 오류가 각자의 코드로 실패.
- `protocol`: §5의 거절 목록, 올바른 요청 통과.
- `cafeBoardSearchEndpoint`·`boardSearchPageReader`: URL에 게시판·검색어·날짜·쪽이 들어가고, 실패가 각 코드로 나뉜다.
- `boardSearchRunner`: 검색어 셋을 예산 안에서 이어 걷기, 예산 소진 시 멈춤, 끝 판정 표 각 줄, 재개 시 마지막 쪽 다시 읽기, 실패하면 다음으로, 중지하면 멈춤.
- 저장소: 작업 생성이 사전 순서대로 행을 만들고 교체가 모든 행을 바꾸며 running 실행이 있으면 거절, 쪽 저장과 카운터의 원자성, `WRONG_BOARD`/`OUT_OF_WINDOW`에서 커서 불변.
- `boardSearchJob`: 존재·완료가 행들에서 맞게 모이고, 완료된 작업은 `start`하지 않는다.
- `boardSearchCoverageQuery`: 기준선과 잔여 계산, 지문 캐시.
