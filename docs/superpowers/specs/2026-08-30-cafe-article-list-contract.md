# 네이버 카페 전체글 목록 계약 조사

- 조사일: 2026-08-30 (KST)
- 대상: 카페 `14538121`, 전체글 메뉴 `0`
- 상태: page 1·과거 page 300·큰 page fallback fixture 완료, 오류 fixture 대기
- 원칙: 읽기 전용 목록 요청만 조사하며 상세 글·댓글·좋아요 쓰기 요청은 하지 않음

## 1. 확인된 요청

전체글 목록 화면:

```text
https://cafe.naver.com/f-e/cafes/14538121/menus/0?viewType=L&page=1&size=50
```

일반 글 50건 목록 API:

```text
GET https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles
  ?page=1
  &pageSize=50
  &sortBy=TIME
  &viewType=L
```

페이지 자산 관찰 결과 initiator는 `fetch`이며 manifest에 이미 허용된 `https://apis.naver.com/*` 범위 안이다.

일반 목록과 별도로 화면은 아래 두 요청을 사용한다.

```text
GET https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/uparticles/menus/0
GET https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/notices/menus/0
```

1차 수집은 `articles`만 호출한다. `uparticles`와 `notices`를 호출하지 않으므로 공지 숨김 체크박스의 UI 상태나 저장 값을 자동화할 필요가 없고, 매 페이지 반복 공지도 수집 입력에 들어오지 않는다.

## 2. 확인된 클라이언트 변환 계약

페이지 번들 `app/cafes/[cafeId]/menus/[menuId]/page-*.js`의 목록 변환 코드에서 아래 필드를 확인했다. raw 이름은 번들에서 읽은 이름이며, 내부 이름은 1차 수집 타입 후보다.

| raw 필드 | 내부 후보 | 비고 |
|---|---|---|
| `articleId` | `postId` | 문자열로 변환 |
| `cafeId` | `cafeId` | 문자열로 변환 |
| `subject` 또는 `title` | `title` | `subject` 우선 |
| `summary` | 후속 `summary` | 1차 저장 여부는 별도 결정 |
| `writeDateTimestamp` | `postedAt` | 원본 목록 경로의 정확한 timestamp 후보 |
| `refArticle` | `isReplyPost` | 답글 여부 |
| `delParent` | `isDeletedParent` | 원글 삭제 답글 여부 |
| `boardType` | `boardType` | 특수 게시판 판별 후보 |
| `writerInfo.memberKey` | `authorId` | DOM `writerInfo${memberKey}`와 동일한 안정 ID |
| `writerInfo.nickName` 또는 `writerNickname` | `authorNickname` | `nickName` 우선 |
| `writerInfo.memberLevel*` | `authorLevel*` | 1차 필수 여부 별도 결정 |
| `writerInfo.secedeMember` | `isSecededAuthor` | 탈퇴 회원 상태 |
| `writerInfo.manager`, `staff` | 작성자 역할 | 필요 시 저장 |
| `menuId`, `menuName` | `boardId`, `boardName` | 전체글 행의 게시판 분류 |
| `headId` + head 변환값 | `prefix` | 이름 필드의 정확한 raw 구조는 fixture로 확정 |
| `commentCount` | `commentCount` | 누락 시 클라이언트가 0으로 정규화 |
| `readCount` | `viewCount` | 누락 시 클라이언트가 0으로 정규화 |
| `likeCount` | 후속 `likeCount` | 목록 raw에는 있으나 전체글 목록 UI에는 표시되지 않아 1차 제외 |
| `replyArticleCount` | `replyCount` | 필요 시 저장 |
| `newArticle` | `isNew` | 표시용 상태 |
| `liked` | 후속 `isLikedByMe` | 개인 세션 상태라 분석 원본으로 부적합 |
| `hasCalendar/File/Vote/Image/Map/Movie` 등 | 첨부 유형 | 1차 제외 가능 |
| `pageInfo.lastNavigationPageNumber` | 페이지 메타데이터 | 정확한 의미 fixture 검증 필요 |
| `pageInfo.visibleNextButton` | `hasMore` 후보 | 종료 조건 fixture 검증 필요 |
| `pageInfo.totalArticleCount` | `totalArticleCount` | 최대 페이지 계산 후보 |

검색 목록용 별도 변환 경로에는 `addDate` 문자열을 `new Date(addDate).getTime()`으로 바꾸는 코드도 존재한다. 1차 전체글 API가 실제로 `writeDateTimestamp`를 반환하는지 raw fixture로 최종 확정한다.

## 3. 현재 확정 가능한 판단

1. 전체글 일반 목록은 한 요청에 정확히 최대 50건이다.
2. 최신순은 `sortBy=TIME`으로 요청된다.
3. `page=N`과 `pageSize=50`으로 임의 페이지 접근이 가능하다.
4. 공지는 일반 글 API와 분리되어 있으므로 일반 글 수집에서 자연스럽게 제외할 수 있다.
5. 작성자 안정 식별자는 `writerInfo.memberKey`다.
6. 정확한 작성 timestamp 필드가 클라이언트 모델에 존재한다.
7. 게시판 ID·이름이 전체글의 각 글 데이터에 포함된다.
8. 조회·댓글 수는 표시용 축약 문자열이 아니라 숫자 raw 필드에서 온다.
9. 좋아요 수도 raw 모델에는 있으나 1차 제품 범위에서는 저장하지 않는다.

## 4. page 1 fixture에서 확정된 응답 계약

`tests/fixtures/cafe-article-list-page-1.json`에서 다음을 확인했다.

- top-level: `result`
- `result.articleList`: 50개
- 각 원소: `{ type: "ARTICLE", item: { ... } }`
- `result.pageInfo`: `lastNavigationPageNumber`, `visibleNextButton`, `totalArticleCount`
- `articleId`: number
- `writeDateTimestamp`: millisecond epoch number
- `writerInfo.memberKey`: string
- 말머리 있는 글의 `headId`: number, `headName`: string. 말머리 없는 글은 두 필드를 함께 생략
- `commentCount`, `readCount`, `likeCount`, `replyArticleCount`: number
- `menuId`, `menuName`, `boardType`, `menuType`: 글별 게시판 분류
- page 1 표본에서 댓글 0건 6개, 말머리 없음 1개 확인
- page 1 전체 50건의 `likeCount`가 모두 0이어서 전체글 피드의 분석 가능한 좋아요 값으로 신뢰하지 않음

page 1 캡처 당시 `pageInfo`는 다음 의미와 일치했다.

- `lastNavigationPageNumber = 10`: 현재 페이지 그룹의 마지막 번호
- `visibleNextButton = true`: 다음 페이지 그룹 존재
- `totalArticleCount`: 수집 시점 전체 일반 글 수

## 5. 추가 raw fixture에서 반드시 확인할 항목

API 주소를 브라우저 탭에서 직접 여는 동작은 `ERR_BLOCKED_BY_CLIENT`로 차단됐다. 프로젝트 확장의 로그인 세션 기반 `fetch`/`PROBE` 경로로 다음 fixture를 캡처해야 한다.

- 댓글 0, 말머리 없음, 탈퇴 작성자, 삭제된 원글의 답글 포함 페이지
- 실제 유효 마지막 페이지의 응답
- 로그인 만료/권한 실패 envelope

fixture는 쿠키·계정 ID·불필요한 프로필 URL을 제거하고 memberKey는 길이와 null 가능성만 유지하는 결정적 값으로 치환한다.

## 6. Phase 0 완료 전 남은 결정

- 오류 envelope 구조
- `visibleNextButton`과 빈 `articleList` 중 어떤 것을 최종 종료 신호로 삼을지
- HTTP 상태별 재시도 가능성

추가 fixture에서 다음이 확정됐다.

- page 300: 50건, 2026-07-28 KST 구간, millisecond timestamp 유지
- page 14795: 빈 페이지/오류가 아니라 최신 글 50건으로 silent fallback
- silent fallback에서도 `visibleNextButton=true`, `lastNavigationPageNumber=10`이므로 이 필드만으로 요청 page 유효성을 판정할 수 없음
- page 1과 page 14795는 캡처 사이 새 글 2건이 들어와 ID 48개가 겹치지만 `page_identity`는 다르다. 서로 다른 시점 fixture의 identity 동치는 fallback 증거가 아니다.
- 수집기는 **같은 실행 시작에 읽은** page 1 baseline의 `page_identity`, timestamp window, 요청 page 그룹과 모순되는 `lastNavigationPageNumber`를 함께 써서 fallback을 탐지한다. overlap 임계치는 Phase 4 scenario fixture에서 정하며 현재 48/50 표본을 일반 상수로 승격하지 않는다.

Phase 1 parser 규칙은 다음으로 고정한다.

- `result.articleList`의 각 원소는 정확히 `{ type: "ARTICLE", item: object }`여야 한다. 다른 `type`은 공지로 건너뛰지 않고 페이지 전체를 `UNEXPECTED_LIST_ENTRY_TYPE` 오류로 거부한다. 공지는 별도 `notices` endpoint에 있으므로, 침묵한 누락보다 계약 변경을 드러내는 편이 안전하다.
- `articleId`, `cafeId`, `menuId`, 작성 millisecond epoch, `readCount`, `commentCount`, `replyArticleCount`, `pageInfo` 숫자는 null·음수·안전하지 않은 정수를 거부한다. `writerInfo.memberKey`, 닉네임, 제목은 원본이 명시적으로 `null`일 때만 null을 보존한다. 말머리 없는 글은 `headId`와 `headName`을 함께 생략하는 실제 응답을 `prefix=null`로만 허용하며, `headId`가 있는데 이름이 없는 경우는 거부한다.
- `likeCount`는 raw contract에 남아 있어도 Phase 1의 결과 타입에 넣지 않는다.
- `page_identity`는 `article-page-v1\\0` 뒤에 일반 글 ID를 ECMAScript code-unit 순으로 정렬해 NUL로 이어 붙인 문자열의 Unicode code point 열을 FNV-1a 64-bit로 누적한 hash(`fnv1a64:<16자리 hex>`)다. 빈 `articleList`에도 identity는 계산하되, 종료 여부는 Phase 4 orchestration이 결정한다.

이 항목이 fixture로 닫히기 전에는 파서와 PostgreSQL migration 구현에 들어가지 않는다.

## 7. 안전한 raw fixture 캡처 절차

목록 응답에는 작성자 닉네임·`memberKey`·프로필 URL과 예상하지 못한 계정 관련 필드가 들어갈 수 있다. 일반 `scripts/probe.mjs`에 이 목록 URL을 넘겨 raw 파일을 만들지 않는다. 해당 URL은 스크립트 차원에서도 거부한다.

대신 `scripts/capture-cafe-articles.mjs`가 정확히 다음 요청 한 종류만 허용한다.

```text
https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/14538121/menus/0/articles
  ?page=<양의 정수>&pageSize=50&sortBy=TIME&viewType=L
```

응답 raw text는 프로세스 메모리에서 JSON으로 파싱한 뒤에만 처리한다. 쿠키·토큰·세션 계열 키는 제거하고, 계정·작성자·`memberKey`·닉네임은 결정적으로 치환하며(동일 값은 동일 가명, `memberKey` 문자열 길이와 null은 유지), 게시글 제목·요약과 HTTP(S) URL(프로필 URL 포함)은 fixture용 값으로 치환한다. raw 본문은 콘솔이나 파일에 쓰지 않는다. 결과 파일은 `0600` 권한과 create-only(`wx`)로 작성하므로 기존 fixture도 덮어쓰지 않는다.

앱이 localhost bridge `39217`을 소유하므로, 실제 캡처 때는 다음 순서를 따른다.

1. Whisky Manager를 정상 종료한다. 프로세스를 강제 종료하지 않는다.
2. 저장소 루트에서 `pnpm capture:cafe-articles -- 1`을 실행한다. 첫 페이지 fixture는 `tests/fixtures/cafe-article-list-page-1.json`으로만 생성된다.
3. CLI가 표시한 캡처용 bridge 페어링 토큰을 Chrome 확장 옵션에 붙여넣고 저장한다. 로그인 세션은 브라우저 안에 남고 쿠키는 확장 밖으로 나오지 않는다.
4. 성공 후 `git diff -- tests/fixtures/cafe-article-list-page-1.json`으로 익명화 결과만 검토한다. 마지막 페이지·과거 페이지가 필요하면 `1` 대신 해당 양의 페이지 번호로 같은 명령을 실행한다.
5. 앱을 다시 열기 전에 확장 옵션의 페어링 토큰을 앱의 토큰으로 복구한다(앱의 확장 연결 안내에서 확인). 이 캡처용 토큰 파일 `.wm-probe-token`은 gitignore 대상이다.

이 도구는 성공·오류 envelope나 필드 경로를 해석하지 않는다. Phase 0 계약을 추측으로 고정하지 않기 위해, sanitization 뒤 fixture를 검토한 다음에만 다음 절의 미결 항목을 확정한다.
