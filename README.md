# whisky-manager

네이버 카페 관리 자동화 도구. 1차 목표는 가입인사 전용 게시판에 올라온 신규 글에 자동으로 환영 댓글을 다는 것이며, 자동화 작업을 플러그인처럼 추가할 수 있는 구조로 만든다.

**대상 카페는 소스에 없다.** 카페 ID, 게시판 ID, 카페 주소는 전부 앱 설정에서 입력한다. 설정하기 전에는 세션이 열리지 않고 이유를 화면에 표시한다.

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
| [Chrome 확장 수동 설치 안내](docs/chrome-extension-manual-installation.md) | 비개발자용 확장 설치·앱 연결·문제 해결 안내 |
| [설정 전달 설계](docs/superpowers/specs/2026-08-27-config-export-import-design.md) | 설정 export/import — 담는 것과 담지 않는 것, 거절 사유 |

구현 계획서는 `docs/superpowers/plans/`에 있다.

## 핵심 규칙

**승인 정책** — 자동화 기능마다 개별 설정한다. 세 모드의 구분 축은 "위험 신호가 붙은 후보를 만났을 때 사람을 부르는가"다.

| 정책 | 정상 후보 | 위험 신호가 붙은 후보 |
|---|---|---|
| `AUTO` | 즉시 실행 | 스킵 후 기록. 사람을 부르지 않음 |
| `SEMI` | 즉시 실행 | 승인 큐로 |
| `MANUAL` | 승인 큐로 | 승인 큐로 |

**세션 모델** — 사람은 균등 간격으로 댓글을 달지 않는다. 앉은 김에 몰아서 하고 한참 쉰다. 실제 수치는 [`src/shared/profiles.ts`](src/shared/profiles.ts)가 갖는다.

**안전장치** — 승인 정책과 독립적으로 항상 적용되며 승인으로 우회되지 않는다. 나이 기준 백로그 브레이크, 원자적 중복 선점, 킬 스위치, 긴급 회수.

## 설정

앱을 처음 켜면 아무것도 설정되어 있지 않다. **공통 설정에서 카페 ID와 카페 주소를, 자동화 설정에서 게시판 ID를 입력해야** 세션이 열린다. 입력 전에는 대시보드가 `카페와 게시판을 먼저 설정해야 합니다`로 거절한다.

개발 중에는 데이터베이스를 새로 만들 때마다 같은 값을 다시 넣게 되므로, `config/local.json`에 적어 두면 **패키징하지 않은 실행에 한해** 빈 설정을 채운다. 이 파일은 저장소에 올라가지 않는다.

```bash
cp config/local.example.json config/local.json
```

**다른 기계로 옮길 때는 설정 파일을 쓴다.** `카페 · 계정 설정` 화면의 `내보내기`가 카페·운영진 계정·승인 정책·게시판·문구를 JSON 파일 하나로 저장하고, 운영자 PC에서 `가져오기`로 그 파일을 엽니다. 페어링 토큰과 실행 이력은 기계마다 달라야 하므로 담기지 않고, 자동화는 언제나 꺼진 상태로 들어옵니다 — 확장을 연결하고 설정을 확인한 뒤 직접 켜야 합니다.

## 개발

```bash
pnpm install
pnpm test
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
git tag v0.1.1
git push origin v0.1.1
```

서명 인증서가 없는 빌드는 테스트용 산출물입니다. 실제 배포 전에는 macOS 공증·서명, Windows 코드 서명, Chrome 웹스토어 비공개 등록을 별도로 구성해야 합니다.

Windows MSI는 Windows 환경에서만 만들 수 있습니다. 로컬 Windows에서는 `pnpm package:app:win`을 실행하고, 일반 Release에서는 태그 푸시 후 GitHub Actions의 Windows runner가 `Whisky-Manager-<version>.msi`를 생성합니다.
