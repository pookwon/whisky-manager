# 자동 업데이트 설계

- 작성일: 2026-10-14 (KST)
- 범위: Windows 우선. mac은 다운로드 후 dmg를 열어 주는 데까지.

## 1. 목표

운영자가 GitHub Release를 직접 찾아 설치하지 않아도, 앱이 `pookwon/whisky-manager`의 최신 릴리스를 확인하고 받아 설치한다. 설치는 운영자가 누른 뒤에만 시작하고, 수집·인사 세션이 도는 중에는 끝날 때까지 기다린다. 업데이트 뒤 확장 폴더 재배치와 Chrome 리로드의 수동 단계도 없앤다.

성공 기준:

1. 새 릴리스가 올라오면 6시간 안에(또는 앱 시작 시) 트레이와 화면에 "준비됨"이 보인다.
2. 운영자가 누르면, 유휴일 때 앱이 종료되고 새 버전이 설치되어 다시 실행된다.
3. 검증(SHA-256) 실패, 네트워크 오류, 설치 실패 어느 경우에도 구버전 앱이 그대로 남고 운영자는 한 줄 사유를 본다.
4. 업데이트 뒤 확장이 최신 파일로 다시 읽힌다(확장이 새 핸들러를 가진 경우).

## 2. 고정 사항

- 업데이트 소스는 상수 하나다: `UPDATE_REPOSITORY = 'pookwon/whisky-manager'` (`src/shared/updateSource.ts`). 설정 파일·환경변수·UI로 바꿀 수 없다.
- 확인 URL: `https://api.github.com/repos/pookwon/whisky-manager/releases/latest`. 인증은 쓰지 않는다(public, 시간당 60회).
- 받는 URL은 응답의 자산 `browser_download_url`이며, 호스트가 `github.com`이고 경로가 `/pookwon/whisky-manager/releases/download/`로 시작할 때만 받는다. 리다이렉트는 `redirect: 'manual'`로 한 단계씩 직접 따라가며, 매 단계의 호스트가 `github.com` 또는 `*.githubusercontent.com`(실제 리다이렉트는 `release-assets.githubusercontent.com`)일 때만 계속한다(최대 5단계).
- 자산 선택: Windows는 `Whisky-Manager-<version>.msi`. 무결성은 자산 JSON의 `digest`(`sha256:<hex>`)로 검증한다. `digest`가 없는 릴리스는 설치하지 않는다(실패로 취급).
- 버전 비교는 `MAJOR.MINOR.PATCH`만 지원한다. 현재와 같거나 낮으면 무시한다. `draft`·`prerelease`는 무시한다.
- 시각은 KST로만 표시한다. `kst.ts`의 `KST_OFFSET_MS`와 포맷터를 쓴다.

## 3. 구성

새 파일을 추가하고 기존 파일은 연결만 고친다.

| 파일 | 책임 | 의존 |
|---|---|---|
| `shared/updateSource.ts` | 저장소·허용 호스트 상수, 다운로드 URL 허용 판정 | 없음 |
| `shared/releaseSelection.ts` | 릴리스 JSON → `{version, assetName, url, sha256, size} \| null`, 버전 비교 | `updateSource` |
| `desktop/updateDownload.ts` | `userData/updates/`에 `<name>.part`로 받고 SHA-256 검증 후 rename, 지난 파일 정리 | fetch·fs 포트 |
| `desktop/updateInstaller.ts` | 설치 전략(포트 구현). `WindowsMsiInstaller`, `OpenInstallerFile`(폴백, mac) | spawn·shell 포트 |
| `desktop/updateCoordinator.ts` | 상태기계, 주기 확인, 유휴 대기 | 위 전부 + `isBusy`, `clock` |
| `desktop/extensionRestage.ts` | 버전이 바뀐 첫 실행에 확장 폴더 재배치 + `RELOAD` 전송 | `extensionBundle.mirrorDirectory`, bridge |
| `shared/text.ts` `TEXT.update` | 트레이·배너·로그 문구 | — |
| 렌더러 배너 + 트레이 항목 | 상태 표시와 "지금 업데이트" | IPC |

원칙: 설치 전략은 `UpdateInstaller` 인터페이스 뒤에 두고 OS별 구현을 주입한다. 코디네이터는 어떤 OS인지 모른다.

## 4. 상태기계

```
idle → checking → idle              (새 버전 없음)
idle → checking → downloading → ready
ready → (운영자 누름) → waitingIdle → applying
any  → failed(reason) → idle        (다음 주기에 재시도)
```

- 확인은 앱 시작 직후와 6시간마다. 이미 `downloading`/`applying`이면 건너뛴다.
- `ready`에서 운영자가 취소할 수 없다. 누르기 전에는 아무것도 바뀌지 않는다.
- `waitingIdle`: `isBusy()`가 false가 될 때까지 30초마다 확인한다. 기다리는 동안 화면에 "<세션> 끝나면 설치합니다 · 다음 세션 HH:MM KST"를 보여 준다. 운영자가 기다림을 취소할 수 있다(`ready`로 복귀).
- `applying`: 먼저 `context.shutdown()`(자동화·수집 루프와 러너 정지, 브리지·DB 닫기)을 15초 한도로 기다린 뒤 `userData/update-pending.json`에 `{from, to, at}`을 쓰고 `app.exit(0)`로 끝낸다. 시작 시 이 파일을 읽어 항상 삭제하고, `getVersion() === to`이면 성공, `=== from`이면 설치 실패로 기록하며, 둘 다 아니면(수동 설치 등) 기록 없이 무시한다. 파일을 쓰지 못하면 설치를 시작하지 않는다.
- `ready`에서 더 새 릴리스가 보이면 그 버전으로 교체해 다시 받는다. `waitingIdle`에서는 이미 받은 버전을 설치하고, 더 새로운 것은 다음 확인에서 이어서 받는다.

## 5. 유휴 판정 (`isBusy`)

`bootstrap`이 다음의 합성으로 만든다. 하나라도 진행 중이면 바쁘다.

- 모든 자동화 런타임의 `sessionProgress() !== null`(인사·접두어 안내 세션)
- 수집 파이프라인/러너, `memberCollectionRunner`, 회원 재동기화, `boardSearchRunner`, `articleProbeRunner`의 `isRunning()`

구현 단계에서 각 러너의 실제 접근자 이름을 코드로 확인해 빠진 것이 없게 한다. `isBusy`가 여전히 true인 채 설치가 시작되면 안 된다는 것이 불변식이다: `applying`으로 넘어가기 직전에 한 번 더 확인한다.

`sessionProgress()`는 세션이 네이버를 건드린 뒤에야 값을 가지므로, 대기열에 들어갔거나 막 시작한 세션을 놓친다. 그래서 `naverSession` 큐에 들어온 순간부터 끝날 때까지 세는 `pendingSessions` 카운터를 두고 `isBusy`에 합친다. 이 카운터는 협력 양보 판정(`isAnySessionInFlight`)에는 쓰지 않는다 — 수집이 대기 중인 세션에 양보하면 의미가 바뀐다.

## 6. Windows 설치 (`WindowsMsiInstaller`)

- `package.json`의 `build.win.msi.perMachine`을 `false`로 명시한다(기본값과 같지만 사일런트 설치가 이 가정에 달려 있다). 생성된 MSI는 per-user(`ALLUSERS=2`, `MSIINSTALLPERUSER=1`)이므로 UAC 없이 `msiexec /qn`이 동작한다. `UpgradeCode`는 `appId`에서 고정 생성되고 `MajorUpgrade`가 있어 덮어 설치된다.
- 앱은 분리된 헬퍼를 띄우고 스스로 종료한다. 헬퍼(PowerShell 한 줄 스크립트, 인자는 모두 경로·pid):
  1. 앱 pid가 사라질 때까지 최대 60초 기다린다. 그때까지 남아 있으면 설치하지 않고 마법사를 열어 둔 채 `update-error.log`에 `APP_STILL_RUNNING`을 남긴다(살아 있는 앱 위에 설치하지 않는다).
  2. `msiexec /i "<msi>" /qn /norestart /l*v "<userData>\update-install.log"` 실행, 종료 코드를 저장한다.
  3. 종료 코드와 상관없이 설치된 `Whisky Manager.exe`를 실행한다(성공이면 새 버전, 실패면 MSI 트랜잭션 롤백으로 남은 구버전). 실행 파일이 없거나 10초 안에 같은 이름의 프로세스가 보이지 않으면 설치 파일을 연다.
  4. 종료 코드가 0이 아니면 `update-error.log`에 `<KST 시각> <코드>`를 쓴다.
- 헬퍼를 띄우지 못하면(`spawn` 오류) `shell.openPath(msi)`로 마법사를 열고 상태를 `failed('HELPER_UNAVAILABLE')`로 둔다. 앱은 종료하지 않는다.
- 헬퍼의 모든 단계는 타임아웃을 갖는다. 앱이 영영 안 뜨는 상태가 가장 나쁜 결과다.
- 실행 파일 경로는 `process.execPath`로 얻는다(하드코딩 금지).
- 앱은 `requestSingleInstanceLock()`을 잡는다. 두 번째 인스턴스는 조용히 종료한다. 고정 포트(39217) 충돌로 치명 오류 대화상자가 뜨는 경로를 막는다.

## 7. mac

같은 코디네이터를 쓰되 설치 전략은 `OpenInstallerFile`이다: 받은 dmg를 검증한 뒤 `shell.openPath`로 열고 안내 문구를 보여 준다. 무인 설치는 범위 밖(서명 필요).

## 8. 확장 자동 재배치와 리로드

- 새 버전으로 처음 켜질 때(`update-pending.json`의 `to`와 같거나, `userData`에 기록된 `lastStagedAppVersion`과 다를 때) `mirrorDirectory`로 `chrome-extension` 폴더를 재배치한다. 폴더 경로는 바뀌지 않는다.
- 확장이 HELLO로 연결되면, 이번 실행에서 재배치가 확장 파일을 실제로 바꿨을 때에 한해 앱이 `{ type: 'RELOAD' }`를 한 번 보낸다. 실행 시작 시 켜지고 첫 전송에서 꺼지는 래치다. 리로드 뒤의 재연결에서는 다시 보내지 않는다. 확장은 `chrome.runtime.reload()`로 자신을 다시 읽고 소켓을 다시 연다.
- `PROTOCOL_VERSION`은 올리지 않는다. 구확장은 `isAppMessage`에서 알 수 없는 타입을 걸러 내므로 `RELOAD`를 조용히 무시한다. 따라서 이 핸들러가 들어간 확장이 처음 설치될 때만 수동 리로드가 한 번 필요하다.

## 9. 실패와 기록

| 상황 | 동작 | 기록 |
|---|---|---|
| 네트워크 오류 / 4xx·5xx / rate limit | 다음 주기에 재시도 | `update-status.log` |
| `digest` 없음 또는 불일치 | 받은 파일 삭제, 설치 안 함 | 사유 코드 |
| 자산 없음(이 OS용 파일이 릴리스에 없음) | 무시하고 다음 주기 | 사유 코드 |
| 헬퍼 실행 실패 | 마법사로 폴백, 앱 유지 | 사유 코드 |
| msiexec 실패 | MSI 롤백, 구앱 재실행 | `update-error.log` (KST) |

운영자 화면에는 사유 코드를 한국어 한 줄로만 보인다. 로그의 시각은 `kst.ts`로 만든다.

## 10. 테스트

- `releaseSelection`: 자산 선택, 버전 비교(같음/낮음/높음, 잘못된 태그), draft·prerelease 무시, digest 누락, 허용되지 않은 URL.
- `updateCoordinator`: 모든 전이를 가짜 포트(fetch·clock·installer·isBusy)로. 유휴대기 중 busy→idle 전환, 대기 취소, `applying` 직전 재확인, 실패 후 다음 주기 재시도.
- `updateDownload`: 부분 파일 정리, 해시 불일치 시 삭제, rename 원자성.
- `WindowsMsiInstaller`: 헬퍼 명령 문자열 생성(인자 이스케이프 포함)을 spawn 포트 가짜로 검증.
- `extensionRestage`: 같은 버전에서 두 번째 호출은 아무것도 하지 않음.
- 확장: `RELOAD` 수신 시 `chrome.runtime.reload` 호출, 구형 메시지는 영향 없음.
- 수동(Windows 기계): 실제 MSI로 1.9.17→다음 버전 업데이트, 앱 종료 후 재실행, 확장 리로드, 실패 경로(디스크에서 MSI를 손상시켜 digest 불일치 확인).

## 11. 범위 밖

코드 서명, mac 무인 설치, 델타 업데이트, 릴리스 채널(베타), 롤백 UI, 자동 적용(운영자 확인 없이).

## 12. 열린 위험

- 무결성의 근거는 GitHub API의 자산 `digest`뿐이다. 이는 전송 손상과 네트워크 공격자를 막지만, 릴리스 저장소나 `pookwon` 계정이 탈취된 경우에는 서명이 없는 MSI가 그대로 설치된다. 서명 없는 배포에서 받아들이는 위험이며, 계정 2FA를 전제로 한다. 오프라인 키 서명은 코드 서명과 함께 범위 밖이다.
- 서명이 없어 SmartScreen이 `msiexec` 설치를 막을 가능성이 있다. 앱이 직접 실행하면 Mark-of-the-Web이 없어 대체로 통과하지만, 실제 Windows 기계에서 확인해야 한다.
- 자산 `digest`는 v1.9.17 릴리스의 모든 자산에서 채워져 있음을 `gh api`로 확인했다(2026-10-14). 비어 있는 릴리스는 설치하지 않는다.
