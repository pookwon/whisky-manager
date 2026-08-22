# whisky-manager

네이버 카페 관리 자동화 도구. 1차 목표는 가입인사 전용 게시판에 올라온 신규 글에 자동으로 환영 댓글을 다는 것이며, 자동화 작업을 플러그인처럼 추가할 수 있는 구조로 만든다.

대상 카페: [예시 카페](https://cafe.naver.com/examplecafe) (`clubId=10000000`, 가입인사 게시판 `menuid=5`, 일일 가입자 100~150명)

## 구성

```
[운영 프로필 크롬 — 운영 전용 계정으로 수동 로그인]
        │  확장 (MV3): 수집(fetch) · 실행(fetch→DOM 폴백)
        │  localhost WebSocket + 토큰 페어링
[데스크톱 앱 (Electron, 트레이 상주)]
        │  정책 엔진 · 승인 큐 · 로컬 SQLite
```

판단과 스케줄은 전부 앱에, 수집과 실행만 확장에 둔다. MV3 서비스 워커는 언제든 종료되므로 확장에 업무 상태를 두지 않는다. 확장의 유일한 타이머는 WebSocket 재연결용이다.

**세션 쿠키는 브라우저 밖으로 나가지 않는다.** 확장 매니페스트에 `cookies` 권한을 넣지 않는 것으로 이 원칙을 코드 수준에서 강제하며, 테스트가 이를 감시한다.

## 문서

| 문서 | 내용 |
|---|---|
| [설계 스펙](docs/superpowers/specs/2026-08-22-naver-cafe-automation-design.md) | 아키텍처, 자동화 모델, 승인 정책, 안전장치, 데이터 모델 |
| [기술 스택](docs/tech-stack.md) | 채택 버전과 근거, 기각한 대안, 버전 정책 |
| [구현 계획 A — 기반](docs/superpowers/plans/2026-08-22-naver-cafe-foundation.md) | Phase 0~2. 13개 태스크, TDD 사이클 |
| [구현 계획 C1 — 데스크톱 헤드리스](docs/superpowers/plans/2026-08-22-desktop-headless.md) | Phase 4 전반. 세션 루프, 승인·재시도, Electron 셸 |
| [구현 계획 C2 — 렌더러](docs/superpowers/plans/2026-08-22-desktop-renderer.md) | Phase 4 후반. 대시보드, 승인 큐, 문구, 설정 |

계획 B(가입인사 모듈)와 C(UI·배포)는 아직 작성하지 않았다. 이유는 아래 참조.

## 핵심 규칙

**승인 정책** — 자동화 기능마다 개별 설정한다. 세 모드의 구분 축은 "위험 신호가 붙은 후보를 만났을 때 사람을 부르는가"다.

| 정책 | 정상 후보 | 위험 신호가 붙은 후보 |
|---|---|---|
| `AUTO` | 즉시 실행 | 스킵 후 기록. 사람을 부르지 않음 |
| `SEMI` | 즉시 실행 | 승인 큐로 |
| `MANUAL` | 승인 큐로 | 승인 큐로 |

**세션 모델** — 사람은 균등 간격으로 댓글을 달지 않는다. 앉은 김에 몰아서 하고 한참 쉰다.

| 프로파일 | 세션 주기 | 세션 내 간격 | 세션당 상한 |
|---|---|---|---|
| `production` | 45~75분 | 8~25초 | 15건 |
| `debug` | 2~4분 | 3~8초 | 5건 |

운영 시간대 08:00~24:00, 일일 상한 200건, 주말 세션 주기 1.5배. `debug`는 개발 빌드에서만 선택 가능하다.

**안전장치** — 승인 정책과 독립적으로 항상 적용되며 승인으로 우회되지 않는다. 워터마크(설치 시점 이후 글만), 나이 기준 백로그 브레이크(24시간), 원자적 중복 선점, 킬 스위치, 긴급 회수.

## 개발

```bash
pnpm install
pnpm test          # 106 tests
pnpm typecheck
pnpm lint
pnpm build:all     # 데스크톱 + 렌더러 + 확장
pnpm start         # 빌드 후 Electron 실행
pnpm db:generate   # 스키마 변경 후 마이그레이션 생성
```

첫 실행 시 DB가 `~/Library/Application Support/whisky-manager/`(macOS) 또는 `%APPDATA%\whisky-manager\`(Windows)에 생기고, 페어링 토큰이 자동 생성됩니다. **자동화는 비활성 상태로 시작합니다** — 설정에서 문구를 등록하고 켜야 동작합니다.

## GitHub Release

버전 태그를 `main`에 푸시하면 GitHub Actions가 macOS DMG, Windows MSI 설치 파일, Chrome 확장 ZIP을 만들고 하나의 GitHub Release에 등록합니다.

```bash
git tag v0.1.0
git push origin v0.1.0
```

서명 인증서가 없는 빌드는 테스트용 산출물입니다. 실제 배포 전에는 macOS 공증·서명, Windows 코드 서명, Chrome 웹스토어 비공개 등록을 별도로 구성해야 합니다.

Windows MSI는 Windows 환경에서만 만들 수 있습니다. 로컬 Windows에서는 `pnpm package:app:win`을 실행하고, 일반 Release에서는 태그 푸시 후 GitHub Actions의 Windows runner가 `Whisky-Manager-<version>.msi`를 생성합니다.

## 진행 상태

- [x] 설계 스펙 확정
- [x] 구현 계획 A (Phase 0~2)
- [x] Phase 0 단일 패키지 스캐폴딩
- [x] Phase 1 정책 엔진
- [x] Phase 2 프로토콜·페어링·DB
- [ ] Phase 3 가입인사 모듈 — **선행 작업 필요**
- [x] Phase 4 데스크톱 앱
- [ ] Phase 5 배포

### Phase 3 선행 작업

가입인사 모듈은 네이버 카페의 JSON 응답 스키마를 모르는 상태에서 작성할 수 없다. 추측으로 파서를 쓰면 설계 원칙 위반이다.

운영 계정으로 로그인한 크롬에서 가입인사 게시판을 열고 **DevTools Network 탭의 목록 조회 요청과 댓글 작성 요청**을 캡처해야 한다. `apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json`이 실재하는 엔드포인트임은 확인했으나, 정확한 파라미터와 응답 구조는 세션이 있어야 확인된다.
