# 목록 → 검색어 보충 → 빈 글 번호 확인을 한 줄로 잇는 설계

- 작성일: 2026-10-07 (KST)
- 대상: 수집 화면의 세 단계(1.9.10에서 순서대로 배치한 것)와 검색어 사전
- 상태: 설계 승인, 구현 전

## 1. 왜 필요한가

### 단계 사이를 손으로 넘긴다

1번 목록 수집이 1,000쪽 한계에 닿으면 운영자가 "보충 준비"를 눌러 시작일을 직접 적고 2번을 만든다. 2번이 끝나면 다시 "만들기"를 눌러 3번을 만든다. 스케줄 루프는 **있는 작업만** 돌리므로, 운영자가 자리에 없으면 그 사이가 비어 있다.

또 2번의 시작일은 1번의 기간과 이어져 있지 않다. 폼의 기본값(2025-01-01)이나 앞 작업의 값을 쓴다. 3번은 한 번만 만들 수 있어서 2025 구간을 마친 지금 2024 구간에는 다시 만들 수 없다.

### 사전이 긴 낱말을 빠뜨린다

2025 구간에서 하나씩 읽어 되살린 137의 글 1,616건을 낱말로 세었다(2026-10-07). 그 구간에 던진 검색어 300개와 견주면:

| 제목 | 건수 |
|---|---|
| 던진 검색어와 같은 낱말이 있다 | 27 (거의 `25.02.14` 같은 숫자) |
| **검색어로 시작하는 더 긴 낱말만 있다** | **730 (45%)** |
| 관련 낱말이 없다 | 859 (53%) |

검색은 형태소 단위로 맞추므로(설계 `2026-09-26-article-id-probe-design.md` §1) `홈플`은 `홈플러스`를 찾지 못한다. 사전은 짧은 낱말이 긴 꼴을 덮는다고 셈해서 `홈플러스`(286건), `gs25`(66), `구입기`(54), `홈플런`(28), `글렌버기`(27) 같은 낱말에 검색어를 주지 않았다. 지금 도는 2024 작업의 사전에도 `홈플`, `gs`, `구입`, `구매`, `글렌`만 있다.

## 2. 무엇이 바뀌지 않는가

- 세 실행기(목록·검색·글 읽기)의 걷기, 쪽 검사, 쓰기, 잠금(`collectionLock`), 읽기 줄(`naverReadGate`), 속도(`collectionPacing`).
- 회원 걷기와 회원 재동기화는 지금처럼 루프에서 차례를 받는다.
- 사전의 앞 300개와 그 순서. 확장분은 그 뒤에만 붙는다.
- 이미 답을 얻은 글 번호는 다시 읽지 않는다. 2025 구간의 3번 결과는 그대로 남는다.

## 3. 흐름

### 3.1 단계 판단

새 모듈 `src/desktop/collectionPipeline.ts`가 DB에서 지금 할 단계를 정한다. 판단은 순수 함수(`collectionPipelineStep.ts`)로 두고 화면도 같은 결과를 받는다.

```
기간이 없다                              → idle (기간을 골라야 한다)
1번에 끝나지도 한계에 닿지도 않은 게시판이 있다 → list
한계에 닿았고 search_finished_at이 비어 있는 게시판이 있다
                                          → search(그중 queue_order가 가장 앞선 게시판)
1번 기간에 probe_finished_at이 비어 있다        → probe
그 밖                                     → done
```

- "끝났다/한계"는 지금의 `describeJob`과 같다(`completed_at` 또는 `horizon_reached_at`).
- 한계 게시판은 1번이 **모두** 끝난 뒤에야 보충한다. 1번이 도는 동안에는 2번을 돌리지 않는다.

### 3.2 기간을 이어받는다

1번 기간을 `[periodStart, periodEnd)`라 하자(`feed_state.target_start_ms/end_ms`).

| 단계 | 기간 |
|---|---|
| 2번 (게시판 B) | `fromDay = kstDayKey(periodStart)`, `toDay` = B에 보관된 가장 오래된 글의 날(지금의 `planBoardSearchJob` 그대로) |
| 3번 | `fromDay = kstDayKey(periodStart)`, `toDay = kstDayKey(periodEnd)` — 카페 전체의 빈 번호 |

3번의 끝은 `toDay`의 시작이므로(`createJob`이 `< toDay 00:00`) `periodEnd`가 그대로 반열린 끝이 된다. 3번은 원래 게시판을 가리지 않고 빈 번호를 읽는다.

### 3.3 2번 작업을 맞춘다 (`ensureSearchJob`)

search 단계에서 게시판 B에 대해:

1. 지금 검색 작업이 B이고 `fromDay`가 같으면 **이어받는다**. 진행 기록을 그대로 둔다.
2. 아니면 지금처럼 `replaceJob`으로 B의 작업을 새로 만든다.
3. B의 `search_extended_at`이 비어 있으면 `extendJob`(§4.2)으로 확장 낱말을 붙이고 적는다. 새로 만든 작업은 사전에 이미 확장분이 들어 있으므로 적기만 한다.
4. 모든 검색어가 끝났으면 `feed_state.search_finished_at`을 적고 다음 게시판으로 간다.
5. `planBoardSearchJob`이 `NOTHING_BEFORE`/`NO_QUERIES`/`NO_POSTS`로 거절하면 보충할 것이 없다는 뜻이다. `search_finished_at`을 적고 이유를 진단 로그에 남긴다.

### 3.4 3번 작업을 맞춘다 (`ensureProbeJob`)

- 1번 기간과 같은 창의 3번 작업이 있으면 이어서 읽는다.
- 없으면 만든다. 다른 창의 번호가 아직 기다리고 있으면 만들지 않는다(지금 실제로 생기지 않는 경우, 진단 로그에 남기고 블록을 끝낸다).
- 만들 때 이미 `article_probe`에 있는 번호는 건너뛴다(`on conflict (post_id) do nothing`).
- 넣은 번호가 0개이거나 모든 번호에 답이 나왔으면 1번 기간의 모든 줄에 `probe_finished_at`을 적는다. 그것으로 done이 된다.

### 3.5 같은 블록에서 이어 돈다

세 실행기는 블록이 끝날 때 결과 하나를 돌려준다.

```ts
interface CollectionBlockEnd {
  readonly requests: number                // 이 블록이 쓴 요청 수
  readonly endedBy: 'budget' | 'drained' | 'stopped' | 'failed'
}
```

- `start` 요청에 `onBlockEnd?: (end: CollectionBlockEnd) => void`를 더한다. 잠금을 놓은 **뒤에** 부른다.
- 파이프라인은 블록이 끝나면:
  - `stopped`·`failed`이면 멈춘다. 실패는 지금처럼 카드에 보이고, 다음 블록이 다시 시도한다.
  - `budget`이면 그 블록이 끝이다.
  - `drained`이면 단계를 다시 판단한다. 남은 한도(`maxPages - 쓴 요청 합`)가 있으면 다음 작업을 맞추고(§3.3, §3.4) 남은 한도로 이어 돈다.
  - 요청을 하나도 쓰지 않았는데 단계가 그대로이면 멈춘다(헛도는 고리 방지).
- `stop()`은 지금 도는 실행기를 멈추고, 이어 돌기도 끊는다.
- 수동 "이어서"와 스케줄 블록은 같은 `pipeline.start(maxPages)`를 탄다.

### 3.6 루프

`collectionLoop`에 등록된 `articles`, `boardSearch`, `articleProbe` 세 작업을 `pipeline` 작업 하나로 바꾼다. 회원 두 작업과 차례를 나눈다. `forced`(밤낮 없이)는 list 단계에서만 1번의 값을 따른다. 검색과 글 읽기는 지금처럼 밤낮 없이 돌지 않는다.

## 4. 사전 확장

### 4.1 확장 낱말 고르기 (`boardSearchDictionary.ts`)

지금의 탐욕 선택으로 300개(`picked`)를 뽑은 뒤 한 번 더 고른다.

- 후보: 어떤 `q ∈ picked`로 시작하고 `q`가 아닌 제목 낱말 `w`. `isBoardSearchQuery(w)`를 통과해야 한다.
- 몫: `w`를 그대로 쓴 제목 가운데, `picked`의 어느 낱말도 그대로 쓰지 않았고 앞서 고른 확장 낱말에도 잡히지 않은 제목의 수. 검색이 형태소로 맞춘다는 실측에 맞춘 셈이다.
- 같은 탐욕 방식, 같은 동점 규칙(쓰인 수 → 코드 순서). 몫이 `BOARD_SEARCH_MIN_GAIN`(5) 아래면 멈춘다. 최대 `BOARD_SEARCH_EXTENSION_LIMIT = 300`개.
- 결과는 `[...picked, ...extensions]` 순서이고 확장분도 `expectedGain`을 가진다.

### 4.2 이미 있는 작업에 붙이기 (`extendJob`)

- 그 작업의 검색어 전부를 `picked`로 보고 §4.1의 확장만 계산해, `board_search_state`에 없는 낱말을 `queue_order = max + 1`부터 넣는다. 창(`from_day/to_day`)은 그 작업의 것을 쓴다.
- 있는 줄의 진행 기록은 건드리지 않는다. 같은 낱말은 다시 넣지 않는다.
- 작업 하나에 **한 번만** 붙인다(`feed_state.search_extended_at`). 매 블록 다시 계산하면 새로 모인 제목 때문에 낱말이 끝없이 늘 수 있다.
- `board_search` 실행이 도는 동안에는 붙이지 않는다(`replaceJob`과 같은 규칙).
- 확장분이 붙으면 끝났던 작업도 다시 덜 끝난 작업이 된다. 3번은 확장분까지 끝난 뒤에 간다.

## 5. 저장

마이그레이션 `0010` (drizzle-collection):

- `feed_state.search_extended_at`, `feed_state.search_finished_at`, `feed_state.probe_finished_at` — 모두 `timestamp(3) with time zone null`. 1번 기간을 바꾸면(`replaceJob`) 새 줄이므로 함께 비워진다. `probe_finished_at`은 기간 전체의 사실이므로 그 기간의 모든 줄에 함께 적는다(`forced_at`과 같은 방식).

`article_probe`는 구조가 그대로다. 저장소만 바뀐다.

- `readJob(window)`: 창 하나의 집계. 화면은 1번 기간의 창을 묻는다.
- `createJob`: "아무 줄이나 있으면 던진다"를 "기다리는 번호가 하나라도 있으면 던진다"로 바꾸고, 이미 있는 번호는 건너뛴다.
- `nextWaitingId(window)`: 그 창의 기다리는 번호만.

운영 DB에는 마이그레이션을 사람이 직접 건다(앱을 끄고 `pnpm db:collection:migrate`).

## 6. 화면

- 다음 단계 패널은 파이프라인의 단계를 그대로 보여 준다. 예: `2/3 검색어 보충 · 188 게시판 (한계 게시판 3개 중 1번째)`. 버튼은 "이어서"(`pipeline.start`)와 "멈춤" 하나씩.
- 1번 기간 선택 폼은 그대로 둔다. 운영자가 정하는 유일한 입력이다.
- 2번 "보충 준비" 폼(`BoardSearchJobForm`)과 3번 "만들기" 버튼을 없앤다. 시작일을 손으로 넣으면 파이프라인과 어긋난다. 이를 위한 IPC(`wm:previewBoardSearchJob`, `wm:createBoardSearchJob`, `wm:createArticleProbeJob`)와 각 단계의 "이어서" IPC도 `wm:startCollectionPipeline` 하나로 모은다.
- 단계 카드는 상태와 진행률을 그대로 보여 준다. 3번 카드는 1번 기간의 창을 보여 준다.
- 문구는 `src/shared/text.ts`에 둔다.

## 7. 지금 DB에서 일어날 일

2026-10-07의 상태: 1번 기간 2024-01-01 ~ 2025-01-02, 188·205가 한계, 137·43·253·207·235·165는 아직 1번이 덜 끝났다. 137의 2024 검색 작업(`fromDay 20240101`, 1/300 끝)이 손으로 먼저 만들어져 있다.

1. list: 남은 게시판의 1번을 끝낸다. 137은 1,000쪽을 걸어야 한계가 드러난다(지금 동작 그대로의 비용).
2. search: queue_order 순으로 한계 게시판마다. 137 차례에는 지금 작업을 이어받고 확장분을 붙인다.
3. probe: 2024-01-01 ~ 2025-01-02의 카페 전체 빈 번호.

## 8. 테스트

- 사전: `홈플` 뒤에 `홈플러스`가 붙는다, 몫 5 미만은 붙지 않는다, 한도 300, 앞 300개의 순서가 그대로다.
- 단계 판단: 상태 조합 표로 단위 테스트(idle/list/search/probe/done, 한계 게시판 순서, 거절 시 건너뛰기).
- 파이프라인: 남은 한도로 다음 단계가 이어진다, `stopped`·`failed`에서 멈춘다, 헛도는 고리에서 멈춘다, `stop()`이 이어 돌기를 끊는다.
- 실행기 셋: `onBlockEnd`의 `requests`와 `endedBy`가 맞는다, 잠금을 놓은 뒤에 불린다.
- 통합(`whisky_manager_collection_test`): `extendJob`이 진행 기록을 지키고 두 번 불러도 같다, `search_finished_at`, 3번을 새 창으로 다시 만들 때 이미 있는 번호를 건너뛴다.
