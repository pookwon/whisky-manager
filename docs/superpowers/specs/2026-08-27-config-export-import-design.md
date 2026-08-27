# 설정을 파일 하나로 옮긴다

> 2026-08-27. 개발 기계에서 맞춰 둔 설정을 운영자 PC의 설치본으로 전달한다. 자동화의 판단 규칙은 건드리지 않는다 — 옮기는 것은 설정뿐이다.

## 1. 왜 필요한가

이 도구는 카페를 소스에 담지 않는다. 카페 ID, 카페 주소, 게시판 ID, 운영진 계정, 승인 정책, 환영 문구 — 전부 앱 설정에서 입력하고 그 기계의 데이터베이스에 산다. 그래서 **개발 기계에서 다 맞춰 놓아도 운영자 PC는 아무것도 모르는 상태로 시작한다.**

같은 기계라면 문제가 없다. `main.ts`가 `userData`를 앱 이름이 아니라 고정 경로(`whisky-manager`)로 박아 두어서, 개발 실행과 설치본이 같은 데이터베이스를 쓴다. 옮길 것이 없다.

**다른 기계로 넘길 때만 필요하다.** 운영자에게 카페 ID와 게시판 ID를 불러 주고 문구를 다시 타이핑하게 하는 것이 지금의 유일한 방법이고, 문구는 손으로 다듬은 것이라 다시 치는 동안 달라진다.

## 2. 담는 것과 담지 않는 것

```json
{
  "version": 1,
  "exportedAt": 1756252800000,
  "common": {
    "cafeId": "31068798",
    "cafeUrlName": "whiskyclub",
    "operatorAccounts": ["운영자닉"]
  },
  "automations": [
    {
      "id": "welcome-comment",
      "policy": "SEMI",
      "boardId": "42",
      "enabled": true,
      "templates": [{ "body": "{닉네임}님 환영합니다", "enabled": true }]
    }
  ]
}
```

담지 않는 것과 그 이유:

| 빠지는 것 | 이유 |
| --- | --- |
| `pairingToken` | **그 기계의 확장과 맺은 비밀**이다. 옮기면 운영자 PC가 개발 기계의 확장을 기다린다 |
| `boundExtensionId` | 같다. 어느 확장과 짝지었는지는 기계마다 다르다 |
| 실행 이력 (`executions`) | 설정이 아니다. 중복 방지 기록은 **그 기계가 실제로 단 댓글**이어야 의미가 있다 |
| `limits` | 개발 실행은 `debug` 프로필(세션 간격 2~4분), 설치본은 `production`(3~5시간)이다. 파일이 나르면 개발 페이스가 운영 설치본으로 샌다 |
| 템플릿 `id`·`createdAt` | 그 데이터베이스 안의 신원이다. 들여올 때 새로 발급한다 |

`buildBundle`은 `app_settings` 테이블을 훑지 않고 **세 키를 이름으로 하나씩 집는다.** 이것이 토큰이 따라 나가지 않는 유일한 안전장치다 — 비밀이 이 파일로 나가려면 누군가 그 이름을 코드에 적어야 한다.

## 3. `enabled`는 적되 따르지 않는다

`bootstrap.ts`는 새 데이터베이스의 자동화를 꺼진 채로 심는다.

> Disabled by default. An install that starts posting before anyone has reviewed the settings is the accident this design exists to prevent.

**import이 이 약속을 우회하는 뒷문이 되어서는 안 된다.** 파일에 `enabled: true`가 있어도 `applyBundle`은 항상 `false`로 넣는다.

그러면서도 파일에는 적는다. 개발에서 켜 두고 확인했다는 사실은 기록할 값어치가 있고, 무시했다는 것은 화면이 말한다 — "자동화는 꺼진 상태로 들여왔습니다. 확장을 연결하고 설정을 확인한 뒤 직접 켜세요."

조용히 무시하면 운영자는 켜 놓은 줄 알고 기다린다.

## 4. import는 통째로 갈아끼운다

카페·계정·정책·게시판은 덮어쓰고, 문구는 기존 것을 지우고 파일 목록으로 대체한다. "개발에서 맞춰둔 그대로"가 보장되어야 하기 때문이다. 병합은 두 기계의 설정이 섞인, **어느 쪽도 시험해 본 적 없는 상태**를 만든다.

되돌릴 수 없으므로 화면이 먼저 묻는다. 확인 패널은 대시보드의 강제 실행이 쓰는 것과 같은 모양이다.

문구 순서는 파일 순서를 지킨다. `createdAt`은 정렬에만 쓰이므로, 다른 기계의 시계를 들여오는 대신 `가져온 시각 + 인덱스`로 간격을 준다.

## 5. 경계

| 파일 | 하는 일 | 아는 것 |
| --- | --- | --- |
| `src/shared/configBundle.ts` | 형식 정의와 검증 | 아무것도. node도 electron도 DB도 모른다 |
| `src/desktop/configTransfer.ts` | `buildBundle` / `applyBundle` | repos와 settings만. 파일도 대화상자도 모른다 |
| `src/desktop/rendererApi.ts` | 두 흐름을 잇는다 | 위 둘과 주입받은 파일 포트 |
| `src/desktop/main.ts` | 포트를 `dialog`와 `node:fs`로 채운다 | Electron |
| `src/renderer/views/ConfigTransfer.tsx` | 두 버튼, 확인 단계, 결과 | `api`만 |

검증이 `shared`에 있는 이유는 **파일이 신뢰할 수 없는 입력**이기 때문이다. 운영자가 고른 파일이 이 앱의 출력이라는 보장이 없고, 그 판정에는 데이터베이스가 필요 없다.

파일 접근을 주입받는 이유는 `openExtensionSetup`과 같다. `rendererApi`가 Electron과 `node:fs`에서 자유로워야 모든 분기가 테스트에서 닿는다.

## 6. 거절 사유

컴파일러가 지킨다. `Record<BundleProblem, string>`으로 문구를 키잉하므로, 사유를 union에 추가하고 문구를 안 쓰면 빌드가 깨진다. `RISK_LABEL`과 `outcome.refused`가 쓰는 수법 그대로다.

| 사유 | 언제 |
| --- | --- |
| `NOT_JSON` | JSON이 아니다 |
| `NOT_A_BUNDLE` | 모양이 다르다 — 다른 파일을 골랐다 |
| `UNSUPPORTED_VERSION` | 이 버전이 읽을 수 없다 |
| `NO_CAFE` | `cafeId`가 비어 있다. 넣어도 세션이 열리지 않는다 |

버전 검사는 모양 검사보다 **먼저** 한다. 새 빌드가 쓴 파일에는 이 빌드가 모르는 필드가 있고, 그것을 "우리 파일이 아니다"라고 하면 운영자는 이미 갖고 있는 파일을 찾으러 간다.

읽기 자체의 실패(권한, 사라진 파일)는 사유가 아니라 예외다. 그대로 던져서 화면의 오류 배너가 받는다.

## 7. 원자성

`applyBundle`은 전부를 한 트랜잭션으로 감싼다. 중간에 죽으면 **파일의 카페와 이전의 문구**가 함께 남는데, 이는 어느 기계도 가져본 적 없는 설정이고 아무도 찾아볼 생각을 하지 않는 상태다.

`templatesRepo.replaceAll`도 자기 트랜잭션을 연다 — `dedupeStore.claim`이 이미 쓰는 방식이다. drizzle의 better-sqlite3 드라이버는 중첩을 savepoint로 처리하므로 바깥 롤백이 안쪽 쓰기까지 되돌린다. 테스트가 이를 감시한다.

## 8. 무엇을 테스트하는가

왕복(`build → parse → apply → build`)은 **담은 것끼리만** 비교하므로 담지 말아야 할 것이 담겼는지는 못 잡는다. 토큰이 새는지는 전용 단언이 본다.

- 페어링 토큰·확장 ID·`limits`가 파일에 없다
- import가 페어링 토큰을 지우지 않는다
- 파일이 `enabled: true`여도 꺼진 채로 들어온다
- 문구가 파일 순서로 통째로 갈린다
- 쓰기가 중간에 실패하면 아무것도 남지 않는다
- 이 빌드가 모르는 자동화는 무시하고 개수에 세지 않는다
