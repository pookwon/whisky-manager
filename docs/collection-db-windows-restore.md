# 수집 DB를 Windows로 옮기기

이 문서는 지금 쓰던 기계의 게시판 수집 데이터베이스를 Windows 기계로 옮기는 방법을 설명합니다. 옮기고 나면 그 기계의 Whisky Manager가 지금까지 모은 글을 그대로 이어서 봅니다.

가입인사 자동화는 이 데이터베이스와 무관합니다. 옮기지 않아도 그쪽은 그대로 동작합니다.

## 무엇을 옮기는가

수집 데이터베이스는 PostgreSQL이고, 앱과 따로 삽니다. 옮기는 것은 파일 하나 — 덤프 파일입니다. 이 안에 네 개의 표(`posts`, `boards`, `runs`, `feed_state`)와 **스키마 이력**이 함께 들어갑니다.

**스키마 이력(`drizzle` 스키마)을 빼면 안 됩니다.** 앱은 시작할 때 데이터베이스에 적힌 마이그레이션 해시가 자기가 아는 것과 정확히 같은지 확인하고, 다르면 수집 기능을 켜지 않습니다. 몇 달치 수집분을 앱이 임의로 고치지 않게 하려는 장치입니다. 아래 명령을 그대로 쓰면 함께 담깁니다.

## 준비물

- **보내는 쪽**: 지금 데이터베이스가 있는 기계 (PostgreSQL이 돌고 있는 곳)
- **받는 쪽**: Windows 10 또는 11
- **양쪽 앱은 같은 버전이어야 합니다.** 버전이 다르면 위의 해시 검사에서 걸립니다.

> PostgreSQL 18 설치 프로그램은 Windows 10/11을 대상으로 합니다. Windows 7용 빌드(`win7-*` 태그)를 쓰는 기계라면 이 문서의 방법을 그대로 쓸 수 없습니다.

## 스크립트로 한 번에 (권장)

받는 쪽에서 할 일을 스크립트 하나가 대신합니다 — PostgreSQL 설치 여부 확인과 설치, 덤프 검사, 데이터베이스 생성, 복원, 확인, 앱 설정 파일 작성까지.

1. 보내는 쪽에서 아래 **1. 덤프 뜨기**를 먼저 합니다.
2. 덤프 파일과 `scripts/windows/Restore-CollectionDb.ps1` 을 받는 기계로 옮깁니다.
3. PowerShell을 **관리자 권한으로** 열고 (PostgreSQL을 새로 설치할 때만 필요합니다) 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\Restore-CollectionDb.ps1 -DumpPath C:\Users\사용자\Downloads\collection-20260901.dump
```

비밀번호를 한 번 물어봅니다. PostgreSQL을 새로 설치하는 경우 그 값이 `postgres` 계정의 비밀번호로 설정되고, 이미 설치되어 있으면 기존 비밀번호를 넣으면 됩니다. 끝나면 앱만 다시 켜면 됩니다.

자주 쓰는 선택지:

| 옵션 | 쓰임 |
|---|---|
| `-Force` | 같은 이름의 데이터베이스가 이미 있고 내용이 들어 있을 때 지우고 다시 만듭니다. 없으면 손대지 않고 멈춥니다 |
| `-Port 5433` | 5432가 아닌 포트로 설치했을 때 |
| `-SkipAppConfig` | `collection-db.json`을 건드리지 않습니다 |
| `-InstallerPath "C:\...\postgresql-18-windows-x64.exe"` | winget을 못 쓰는 환경에서 내려받아 둔 설치 프로그램으로 설치 |

스크립트가 멈추면 이유와 다음에 할 일을 화면에 적습니다. 아래 수동 절차는 그때 어디까지 됐는지 짚어 보거나, 스크립트를 쓸 수 없을 때를 위한 것입니다.

## 1. 보내는 쪽에서 덤프 뜨기

터미널에서 실행합니다. 앱을 켜 둔 채로 해도 됩니다 — 뜨는 시점의 일관된 사본이 만들어집니다.

```bash
pg_dump -Fc --no-owner --no-privileges -d whisky_manager_collection -f collection-20260901.dump
```

- `--no-owner --no-privileges`: 받는 쪽에 없는 계정 이름을 덤프에 적지 않게 합니다. 이게 없으면 복원할 때 "role does not exist" 오류가 줄줄이 납니다.
- 파일 이름의 날짜는 뜬 날로 바꿔 두면 나중에 헷갈리지 않습니다.
- 9천 건 기준 1MB가 안 됩니다. USB든 메일이든 편한 방법으로 옮기면 됩니다.

> 덤프에는 카페 회원의 닉네임과 작성자 ID가 그대로 들어 있습니다. 전달 경로를 정할 때 감안하세요.

## 2. Windows에 PostgreSQL 설치하기

1. [PostgreSQL 다운로드 페이지](https://www.postgresql.org/download/windows/)에서 Windows용 설치 프로그램을 내려받습니다.
2. **버전 18 이상**을 고릅니다. 보내는 쪽이 18이라 그보다 낮은 버전으로는 복원되지 않습니다.
3. 설치 프로그램을 실행하고 기본값 그대로 진행합니다. 도중에 두 가지만 기억해 둡니다.
   - **`postgres` 계정의 비밀번호** — 뒤에서 계속 씁니다.
   - **포트** — 기본 `5432`. 바꿨다면 그 번호를 기억합니다.
4. 마지막의 Stack Builder는 필요 없습니다. 체크를 풀고 끝냅니다.

## 3. 빈 데이터베이스 만들고 복원하기

명령 프롬프트를 엽니다. 아래 명령이 "인식할 수 없는 명령"이라고 나오면, 먼저 설치 폴더로 이동한 뒤 실행합니다.

```
cd "C:\Program Files\PostgreSQL\18\bin"
```

빈 데이터베이스를 만듭니다.

```
createdb -U postgres -E UTF8 -T template0 whisky_manager_collection
```

덤프 파일을 복원합니다. 경로는 실제로 파일을 둔 자리로 바꿉니다.

```
pg_restore -U postgres --no-owner -d whisky_manager_collection "C:\Users\사용자\Downloads\collection-20260901.dump"
```

두 명령 모두 비밀번호를 물어봅니다. 2단계에서 정한 `postgres` 비밀번호를 넣습니다. 복원이 잘 되면 **아무 말 없이 끝납니다.** 화면에 오류가 줄줄이 나오면 아래 "문제 해결"을 보세요.

## 4. 제대로 들어왔는지 확인하기

```
psql -U postgres -d whisky_manager_collection -c "select (select count(*) from posts) as 글, (select count(*) from boards) as 게시판, (select count(*) from runs) as 실행"
```

보내는 쪽에서 같은 명령을 돌렸을 때와 숫자가 같아야 합니다.

스키마 이력이 함께 왔는지도 확인합니다. 한 줄이 나와야 하고, 아무것도 안 나오면 앱이 수집을 켜지 않습니다.

```
psql -U postgres -d whisky_manager_collection -c "select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1"
```

## 5. 앱에 데이터베이스 주소 알려주기

앱은 환경변수가 아니라 설정 파일에서 주소를 읽습니다.

1. 트레이(작업 표시줄 오른쪽 아래)에서 Whisky Manager 아이콘을 오른쪽 클릭합니다.
2. **수집 저장소 설정 열기**를 누릅니다. 파일이 없으면 앱이 만들어서 열어 줍니다.
3. 열린 파일의 `databaseUrl`을 아래처럼 채우고 저장합니다.

```json
{
  "databaseUrl": "postgresql://postgres:비밀번호@127.0.0.1:5432/whisky_manager_collection"
}
```

4. 앱을 완전히 종료했다가 다시 켭니다.

이 파일은 `%APPDATA%\whisky-manager\collection-db.json`에 있습니다. 트레이 메뉴 대신 직접 열어도 됩니다.

> **비밀번호에 특수문자가 있으면 바꿔 적어야 합니다.** `@`는 `%40`, `#`은 `%23`, `/`는 `%2F`, `:`는 `%3A`입니다. 주소 안에서 이 글자들은 다른 뜻으로 읽힙니다.

## 6. 앱에서 확인하기

앱을 켜고 **수집 현황** 화면을 엽니다. 글 수와 게시판 수, 최근 실행 목록이 보이면 끝났습니다.

"수집 저장소를 쓸 수 없습니다"가 보이면 이유가 화면에 한 줄로 나옵니다. 같은 내용이 `%APPDATA%\whisky-manager\collection-status.log`에도 적힙니다.

## 문제 해결

| 화면에 나오는 말 | 원인 | 할 일 |
|---|---|---|
| PostgreSQL에 연결하지 못했습니다 | 주소·포트가 틀렸거나 PostgreSQL이 꺼져 있음 | 서비스가 돌고 있는지, 포트 번호가 맞는지 확인 |
| PostgreSQL 접속 계정이 거부됐습니다 | 비밀번호가 틀림 | 특수문자를 바꿔 적었는지 확인 (5단계) |
| 수집용 테이블이 아직 만들어지지 않았습니다 | 복원이 안 됐거나 다른 데이터베이스를 가리킴 | 4단계의 확인 명령을 다시 실행 |
| 저장소의 스키마가 이 버전과 다릅니다 | 양쪽 앱 버전이 다름 | 보내는 쪽과 같은 버전의 앱을 설치 |
| 설치본에 수집용 마이그레이션이 없습니다 | 앱 설치가 깨짐 | 앱을 다시 설치 |

복원할 때 나오는 오류도 몇 가지는 흔합니다.

- **`role "..." does not exist`** — 1단계에서 `--no-owner --no-privileges`를 빠뜨렸습니다. 덤프를 다시 뜨거나, 복원 명령에 `--no-owner`를 넣으세요.
- **`unsupported version ... in file header`** — 받는 쪽 PostgreSQL이 보내는 쪽보다 낮습니다. 18 이상을 설치하세요.
- **`database "whisky_manager_collection" already exists`** — 이미 만들었습니다. 안에 든 게 없다면 그대로 4단계로 가세요.

## 옮긴 뒤에 지킬 것

**두 기계에서 동시에 수집을 돌리지 마세요.** 한 게시판에 대해 진행 중인 수집 작업은 하나만 허용되므로, 나중에 시작한 쪽이 거부됩니다. 옮긴 뒤에는 예전 기계의 수집을 끄고 새 기계에서만 돌리는 것이 안전합니다.

두 기계가 계속 같은 데이터를 봐야 한다면 덤프를 주고받는 대신 **PostgreSQL 한 대를 공유**하는 편이 낫습니다. 양쪽 `collection-db.json`이 같은 주소를 가리키게 하면 됩니다. 이때도 수집을 도는 쪽은 하나여야 합니다.
