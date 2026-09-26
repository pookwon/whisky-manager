# 빈 id를 하나씩 읽어 보충을 마무리하는 설계

- 작성일: 2026-09-26 (KST)
- 대상: 검색어 보충(설계 `2026-09-25-board-search-backfill-design.md`)을 300개 모두 마친 뒤에도 남은 빈 구간의 글
- 상태: 설계 초안, 글 읽기 API 계약 캡처 완료(§5), 구현 전

## 1. 왜 필요한가

검색어 300개를 모두 걸은 뒤(2026-09-26 17:47) 137은 82,661건이 되었다. 빈 구간(2025-01-01 ~ 2025-08-28)의 id 111,973개 중 **9,660개**가 아직 비어 있고, 기준선(2025-09 이후 90일, 6.78%)을 빼면 약 **2,066건**이 남았다고 추정된다.

### 남은 것은 무엇인가 (2026-09-26 표본)

빈 id 100개를 무작위로 골라 글 읽기 API로 하나씩 읽었다(2~3초 무작위 간격).

| 표본 | 삭제 (`4003`) | 로그인 필요 (`0004`) | **137의 살아 있는 글** |
|---|---|---|---|
| 빈 구간 2025-01 ~ 08, 50개 | 38 | 1 | **11 (22%)** |
| 기준선 2025-09 ~ 11, 50개 | 50 | 0 | 0 |

9,660 × 22% ≈ **2,100건**. 추정과 맞는다. 수집하지 않는 게시판의 글은 표본에 없었다.

### 검색이 놓친 이유

검색은 제목을 앞부분 일치로 찾지 않는다. **형태소 단위로 쪼갠 낱말**로 찾는다(2026-09-26 실측).

| 검색어 | 찾는 제목 | 못 찾는 제목 |
|---|---|---|
| `홈플` | `동광주홈플`, `안중 홈플` | `월드컵 홈플러스` (`홈플러스`로는 찾는다) |
| `구매` | `구매했습니다`, `이마트 구매` | `클라이네리쉬 오데이 구매기` (`구매기`로는 찾는다) |

사전(§4 of 2026-09-25)은 "짧은 낱말이 긴 꼴을 덮는다"고 셈했다. 그래서 `홈플러스`, `구매기` 같은 낱말은 몫이 없어 검색어가 되지 못했다. 어떤 사전으로도 닿지 않는 제목도 있다(`땅꾼이 되다....`, `이놈의 알림때문에..ㅋ`).

### 다른 길: id로 직접 읽는다

글 읽기 API는 id 하나에 정확히 답한다. 살아 있으면 게시판·제목·작성자·시각을 주고, 지워졌으면 `4003`이다. 추측할 검색어가 없다. **읽어도 조회수가 오르지 않는다**(753801을 세 번 읽는 동안 669 그대로).

## 2. 무엇이 바뀌지 않는가

- 목록 걷기, 회원 걷기, 검색어 보충: 그대로. 이 작업은 루프가 번갈아 도는 작업 하나가 더 느는 것뿐이다.
- `posts`의 한 행은 어느 길로 읽었든 같은 글이다. 쓰기는 `writePostRows`를 그대로 쓴다.
- 속도: 요청 한 번이 한 쪽이다. 페이싱(`collectionDelayMs`)과 블록 예산(`pagesPerWorkBlock`)을 그대로 따른다.

## 3. 구조

### 새 작업 `articleProbe`

`CollectionJob`의 새 구현. 러너(`articleProbeRunner`)는 검색어 보충 러너와 같은 잠금(`collectionLock`), 같은 `naverReadGate`, 같은 세션 양보(`isSessionBusy`)를 쓴다.

### 새 테이블 `article_probe`

| 열 | 뜻 |
|---|---|
| `post_id` (PK) | 읽을 id |
| `window_from_day`, `window_to_day` | 이 id를 뽑은 빈 구간 (KST `yyyymmdd`) |
| `outcome` | null = 아직 안 읽음. `stored` / `deleted` / `unreadable` / `other_board` / `notice` |
| `board_id` | 읽어서 안 게시판 (`stored`, `other_board`, `notice`) |
| `error_code` | `unreadable`의 코드 (`0004` 등) |
| `probed_at`, `run_id` | 언제, 어느 실행이 읽었나 |

한 번 답을 얻은 id는 다시 읽지 않는다. 지워진 글은 되살아나지 않고, 살아 있는 글은 저장되었으니 목록이나 검색이 나중에 고쳐 쓴다.

### 작업 만들기

검색어 보충 작업의 기간을 그대로 받는다. 그 기간에 저장된 글의 id 최솟값과 최댓값 사이에서 `posts`에 없는 id를 모두 `article_probe`에 넣는다(137 기준 9,660개). 넣는 순간의 목록이 전부다. 읽는 동안 다른 걷기가 채운 id는 읽기 직전에 `posts`를 한 번 더 보고 건너뛴다(`outcome` = `stored`, 요청 없음).

### 읽는 순서

id 오름차순. 이어받기는 `outcome is null`인 가장 작은 id부터다. 커서가 따로 없다.

### 한 id의 판정

| 답 | 처리 |
|---|---|
| 200, `menu.id`가 수집 게시판(`boards`) | 글을 저장한다 → `stored` |
| 200, `isNotice`가 참 (어느 게시판이든) | 저장하지 않는다 → `notice`, `board_id` 기록. 목록 걷기는 공지를 저장하지 않으므로, 여기서 저장하면 `posts`의 유일한 공지가 된다 |
| 200, 수집하지 않는 게시판 | 저장하지 않는다 → `other_board`, `board_id` 기록 |
| 404 `4003` | `deleted` |
| 401 `0004` | `unreadable`, `error_code` 기록. 다시 읽지 않는다. 로그인 실패가 아니라 이 읽기의 게시판별 제한이다(§5) |
| 그 밖 (HTTP 오류, 모양이 다른 응답, 네트워크) | id를 판정하지 않고 **블록을 끝낸다**. 실행은 `failed`, 사유에 코드 |

"모르는 답"을 `unreadable`로 삼키지 않는다. 계약이 바뀌었으면 9,660개가 조용히 판정되어 버린다.

### 실행 행

블록 하나가 `runs` 한 행이다(`feed_kind` = `article_probe`, 새 값). 쪽 수는 읽은 id 수, 신규는 저장한 글 수. 최근 기록에 그대로 나온다. 1.9.8의 교훈대로 블록을 시작할 때 이 feed의 `running` 고아 행을 먼저 닫는다.

## 4. 프로토콜과 확장

### 새 요청 `COLLECT_ARTICLE`

`{ requestId, cafeId, postId }` → `ARTICLE_COLLECTED { result }` 또는 `ERROR { code }`. `result`는

- `{ kind: 'article', post: CollectedPostMetadata }`
- `{ kind: 'absent', code: '4003' | '0004' | … , status }` — 카페가 이유를 붙여 거절한 답

`PROTOCOL_VERSION` 12 → 13. 확장을 반드시 새로 고친다(메모리 `repackage-after-protocol-bump`).

### 확장

`articleReader.ts` 새 파일. 글 목록 읽기와 같은 모양: 요청 하나, 응답 하나, 반복·저장 없음. `naverReadGate`가 목록·검색 쪽과 함께 줄을 세운다(쪽 읽기 종류에 추가). 권한(`https://article.cafe.naver.com/*`)은 이미 있다. referer 규칙은 새로 하나(규칙 5) 둔다: 댓글 읽기의 규칙 3(`||article.cafe.naver.com/gw/v4/`)도 이 주소를 덮지만, 규칙은 요청 하나 동안만 걸리고 id로 지워지므로 id를 같이 쓰면 한 요청의 정리가 다른 요청의 referer를 벗긴다. 댓글 주소는 글 id 뒤에 `/comments/`가 이어지므로 `regexFilter` `^https://article\.cafe\.naver\.com/gw/v4/cafes/[0-9]+/articles/[0-9]+\?`로 글 읽기만 잡는다(우선순위 2).

## 5. 계약 캡처 (2026-09-26)

```
GET https://article.cafe.naver.com/gw/v4/cafes/14538121/articles/{id}?fromList=true&menuId=0&tc=cafe_article_list&useCafeId=true
x-cafe-product: pc
```

200 (728686):

```
result.article.id               728686
result.article.menu.id / name   137 / 국내구입기 & 정보
result.article.subject          월드컵 홈플러스          (평문, 검색과 달리 <b> 없음)
result.article.headId / head    390 / 대형마트
result.article.writeDate        1749029333663            (epoch ms)
result.article.readCount        890
result.article.commentCount     1
result.article.isNotice         false
result.article.writer.memberKey / nick
```

404: `result.errorCode "4003"`, `reason "삭제되었거나 존재하지 않는 게시글입니다."`
401: `result.errorCode "0004"`, `reason "로그인하지 않았습니다."` — 문구와 달리 로그인 실패가 아니다. 게시판 207의 937311은 목록 걷기가 같은 세션으로 저장한 글인데 이 API는 `0004`로 답한다(2026-09-26). 이 읽기의 게시판별 제한으로 보고 `unreadable`로 둔다.

실측으로 확인한 모양(2026-09-26): `result.cafeId`와 `article.menu.id`는 숫자다(글 5개). 말머리 없는 글(928665, 게시판 137)에는 `head`도 `headId`도 키가 없다. `isNotice`는 불리언이다.

답글 수(`replyCount`)는 이 응답에 없다. `CollectedPostMetadata.replyCount`는 파서가 채울 뿐 어디서도 읽지 않고 `posts`에 열도 없다(2026-09-26 확인). 이 파서는 `replyCount`를 넣지 않도록 타입을 `number | null`로 넓히고 null을 준다.

## 6. 화면

수집 현황에 "빈 id 확인" 카드. 검색어 보충 카드와 같은 틀:

- 기간: `2025-01-01 ~ 2025-08-28 사이의 빈 id` (빈 구간의 마지막 날은 검색어 보충 기간 `to_day`의 전날)
- 요약: `확인 3,120 / 9,660 · 저장 684 · 삭제 2,391 · 읽기 불가 45` — 다른 게시판의 글과 공지가 있으면 `· 기타(다른 게시판·공지) N`을 덧붙인다
- 블록이 도는 동안 진행: `이번 블록 40 / 60건`
- 시작 / 이어서 확인 / 중지. 시작 직후 두 번 누를 수 없다(1.9.8의 방식)
- 블록 실패는 경고 문구로

작업은 검색어 보충 작업이 끝난 뒤에만 만들 수 있다(그 기간을 받는다).

## 7. 옮기는 절차

마이그레이션 0009(새 테이블, `collection_feed_kind`에 `article_probe`). 앱 종료 → 마이그레이션 → 새 앱 설치 → 확장 새로고침(메모리 `collection-migration-before-app`).

## 8. 걸리는 시간

9,660건 × (페이싱 평균) ≈ 페이싱 2.5초면 약 7시간의 읽기. 블록과 휴식을 합치면 하루 이틀.

## 9. 테스트

- 파서: 200 / 4003 / 0004 / 모양이 다른 200 / 비JSON — 캡처로 만든 픽스처
- 러너: 판정표 각 줄, 모르는 답에서 블록 종료와 id 미판정, 이미 저장된 id 건너뛰기, 예산, 중지, 고아 행 정리
- 저장소 통합: 작업 만들기(빈 id 뽑기), 판정 기록, 이어받기 순서
- 화면 문구 헬퍼

## 10. 앞 설계의 정정

`2026-09-25` §1 표의 "`글렌`은 `글렌알라키`까지 잡는다"와 §4 사전의 일치 모델(앞부분 일치)은 틀렸다. 검색은 형태소 낱말 일치다(§1 of this). 사전을 고쳐 다시 걷는 일은 하지 않는다 — 이 작업이 남은 것을 정확히 거둔다.
