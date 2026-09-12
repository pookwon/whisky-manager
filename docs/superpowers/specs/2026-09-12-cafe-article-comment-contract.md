# 네이버 카페 일반 글 댓글 계약 조사

- 조사일: 2026-09-12 (KST)
- 대상: 카페 `14538121`, 일반 게시판 글 `931556` (게시판 `36`)
- 방법: 운영자 Chrome DevTools에서 실제 요청을 캡처. 읽기 응답은 `tests/fixtures/article-comments-*.json`에 개인정보를 가짜 값으로 바꿔 저장했다.
- 상태: 읽기·쓰기·삭제 확정.

가입인사 자동화가 쓰는 메모 게시판(`MemoCommentView.nhn`, `MemoCommentPost.nhn`)과는 **호스트도 인코딩도 다르다.** 말머리 안내 자동화는 이 문서의 계약을 쓴다.

## 1. 읽기

```
GET https://article.cafe.naver.com/gw/v4/cafes/{cafeId}/articles/{articleId}/comments/pages/{page}?requestFrom=A&orderBy=asc
```

| 항목 | 값 |
|---|---|
| 필수 헤더 | `x-cafe-product: pc` |
| origin | `https://cafe.naver.com` |
| referer | `https://cafe.naver.com/ca-fe/cafes/{cafeId}/articles/{articleId}` |
| 응답 | `application/json;charset=UTF-8`, HTTP 200 |
| 인증 | 브라우저 세션 쿠키 (확장이 그대로 보낸다) |

`access-control-allow-origin`이 `https://cafe.naver.com` 하나뿐이다. 확장에서 이 요청을 보낼 때 origin이 그것이어야 한다 — 메모 게시판 쓰기에서 referer를 바꿔 보내는 것과 같은 처리를 origin에도 해야 한다.

### 응답 모양

성공 여부를 말하는 필드가 없다. **`result.comments.items`가 배열인 것이 곧 성공**이고, 그렇지 않으면 읽기 실패로 본다(로그인 페이지, 오류 페이지, 권한 없음).

```jsonc
{
  "result": {
    "cafeId": 14538121,
    "articleId": 931556,
    "menuId": 36,
    "user": {                    // 지금 로그인한 사람. 로그인 확인과 쓰기 검증에 쓴다
      "memberKey": "…",
      "nick": "…",
      "isLogin": true
    },
    "article": {
      "menu": { "id": 36, "name": "등업회원 게시판" },
      "headId": 172,             // 말머리. 없는 글은 headId/head가 없다
      "head": "기타취미",
      "commentCount": 19
    },
    "comments": {
      "items": [
        {
          "id": 103813771,
          "writer": { "memberKey": "…", "baMemberKey": "…", "nick": "…" },
          "content": "축하드립니다~!",
          "sticker": { … },      // 없을 수 있다. 스티커만 단 댓글은 content가 ""
          "updateDate": 1788964703000,
          "isDeleted": false,
          "self": false,         // 내가 쓴 댓글이면 true
          "isRef": false         // 대댓글이면 true
        }
      ]
    },
    "displayCommentCount": 19,
    "hasPrev": false,
    "hasNext": false
  }
}
```

우리가 읽는 필드는 넷뿐이다: `result.comments.items[].writer.memberKey`, 같은 항목의 `writer.nick`, `isDeleted`, 그리고 로그인 판정을 위한 `result.user.memberKey`. 나머지는 무시한다.

### 삭제된 댓글

삭제한 댓글은 **목록에서 사라진다.** 캡처 순서가 그 증거다 — 댓글을 달아 `commentId: 103843785`를 받고, 지운 뒤 같은 주소를 다시 읽으니 그 id가 `items`에 없었다.

`isDeleted` 필드는 항목마다 있으므로, 대댓글이 달린 댓글을 지우면 껍데기가 `isDeleted: true`로 남을 가능성이 있다(네이버 웹에서 "삭제된 댓글입니다"로 보이는 경우). 그 경우는 캡처하지 못했다. 파서는 `isDeleted === true`인 항목을 **버린다** — 지워진 댓글의 작성자는 "이 글에 댓글을 단 사람"이 아니기 때문이다. 메모 게시판 파서가 `deleted !== true`로 거르는 것과 같은 규칙이다.

### 댓글이 없는 글

`comments.items`가 **빈 배열**이고 나머지 구조는 그대로다(`tests/fixtures/article-comments-none.json`, 글 `932956`). `comments` 키 자체가 사라지지는 않는다.

이것을 확인한 이유는 쓰기 직전 재확인이 댓글 0인 글에도 요청을 보내기 때문이다. 빈 배열을 읽기 실패로 오해했다면 안내를 달아야 할 글이 모두 건너뛰어졌을 것이다. 그래서 파서는 **빈 배열을 `[]`로, 모양이 어긋난 응답만 `null`로** 돌려준다 — 메모 게시판 파서가 지키는 구분과 같다.

### 페이지

`hasNext`가 다음 페이지 유무를 말한다. 우리에게는 **1페이지면 충분하다.** 확인할 것은 "운영자가 이미 댓글을 달았는가" 하나이고, 운영자 댓글이 2페이지 뒤로 밀릴 만큼 댓글이 많은 글은 안내 대상이 아니다. 1페이지만 읽는 선택은 이 문서에 적어 둔 의도이지 파서의 한계가 아니다.

## 2. 쓰기

```
POST https://apis.naver.com/cafe-web/cafe-mobile/CommentPost.json
```

| 항목 | 값 |
|---|---|
| content-type | `application/x-www-form-urlencoded` |
| 필수 헤더 | `x-cafe-product: pc` |
| origin | `https://cafe.naver.com` |
| referer | `https://cafe.naver.com/ca-fe/cafes/{cafeId}/articles/{articleId}` |
| 인코딩 | **UTF-8 퍼센트 인코딩** (메모 게시판은 MS949였다) |
| CSRF 토큰 | 없음 |

```
content={UTF-8 퍼센트 인코딩된 본문}&stickerId=&cafeId={cafeId}&articleId={articleId}&requestFrom=A
```

메모 게시판이 빈 필드까지 20개를 보내던 것과 달리 다섯 개뿐이다. `menuId`는 **보내지 않는다**(삭제에는 필요하다 — §3).

### 응답

```json
{"commentId":103843785,"refCommentId":103843785}
```

성공하면 새 댓글 id를 돌려준다. 실패 응답은 캡처하지 못했다. 그래서 **응답 본문으로 성공을 판정하지 않는다**: 메모 게시판과 같이 댓글을 다시 읽어 `result.user.memberKey`와 같은 `writer.memberKey`가 보여야 성공이다. 그 편이 200을 돌려주고 아무것도 쓰지 않는 경우까지 잡는다.

## 3. 삭제 (참고)

```
POST https://apis.naver.com/cafe-web/cafe-mobile/CommentDelete.json
cafeId={cafeId}&menuId={menuId}&articleId={articleId}&commentId={commentId}&requestFrom=A
```

이 도구는 댓글을 지우지 않는다. 계약을 적어 두는 이유는 쓰기와 같은 계열임을 보이기 위해서다 — 삭제에는 `menuId`가 필요하고 쓰기에는 필요 없다는 비대칭이 오타처럼 보일 수 있어서다.

## 4. 메모 게시판과 다른 점

| | 가입인사 (메모 게시판) | 말머리 안내 (일반 글) |
|---|---|---|
| 댓글 읽기 | `cafe.naver.com/MemoCommentView.nhn` | `article.cafe.naver.com/gw/v4/…/comments/pages/1` |
| 댓글 쓰기 | `cafe.naver.com/MemoCommentPost.nhn` | `apis.naver.com/cafe-web/cafe-mobile/CommentPost.json` |
| 본문 인코딩 | MS949 | UTF-8 |
| 폼 필드 수 | 20 (빈 값 포함) | 5 |
| 성공 판정 | 재조회 | 재조회 (같음) |
| 작성자 식별 | `writerMemberKey` | `writer.memberKey` |
| 성공 표시 | `isSuccess: "true"` 문자열 | 없음 — `items`가 배열인지로 본다 |
| 로그인 확인 | 게시판 HTML의 `g_sUserId` | 응답의 `result.user.memberKey` |

## 5. 남은 미확인

- **쓰기 실패 응답.** 권한 없는 글, 댓글 잠긴 글에서 어떤 모양인지. 재조회로 판정하므로 막지는 않는다.
- **대댓글이 달린 댓글을 지운 경우** `isDeleted: true` 껍데기가 남는지.

## 6. 확장 권한

`src/extension/manifest.json`의 host permissions에 두 호스트를 더해야 한다.

- `https://article.cafe.naver.com/*` (읽기)
- `https://apis.naver.com/*` (쓰기 — 전체글 목록 수집이 이미 쓰고 있다면 그대로)
