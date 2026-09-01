<#
.SYNOPSIS
    수집 DB 이전 — PostgreSQL 설치부터 덤프 복원, 앱 연결까지 한 번에.

.DESCRIPTION
    Windows 10/11 64비트에서 실행합니다. 덤프 파일 하나를 지정하면
    PostgreSQL 설치 여부를 확인하고, 없으면 설치하고, 빈 데이터베이스를
    만들어 복원한 뒤, 앱이 읽는 설정 파일까지 채웁니다.

    덤프는 보내는 쪽에서 이렇게 뜬 것이어야 합니다.

        pg_dump -Fc --no-owner --no-privileges -d whisky_manager_collection -f collection.dump

    스키마 이력(drizzle 스키마)이 덤프에 들어 있어야 앱이 수집을 켭니다.
    이 스크립트는 복원 전에 그것이 들어 있는지 먼저 확인합니다.

.PARAMETER DumpPath
    복원할 덤프 파일 경로. 필수.

.PARAMETER Force
    같은 이름의 데이터베이스가 이미 있고 내용이 들어 있을 때 지우고 다시 만듭니다.
    없으면 스크립트는 손대지 않고 멈춥니다.

.EXAMPLE
    .\Restore-CollectionDb.ps1 -DumpPath C:\Users\me\Downloads\collection-20260901.dump

.EXAMPLE
    .\Restore-CollectionDb.ps1 -DumpPath .\collection.dump -Port 5433 -SkipAppConfig
#>
# 운영자가 화면을 보며 따라가는 스크립트라 진행 상황은 호스트에 그대로 찍혀야 한다.
# 비밀번호는 함수 경계를 SecureString으로만 넘고, 평문은 PGPASSWORD와 그 값을
# 요구하는 native 호출 지점에서만 잠깐 산다.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '',
    Justification = '운영자가 읽는 진행 표시다.')]
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $DumpPath,

    [string] $DatabaseName = 'whisky_manager_collection',

    [int] $Port = 5432,

    [string] $SuperUser = 'postgres',

    # 물어보지 않고 돌리려면 넘깁니다. 비우면 실행 중에 가려진 입력으로 받습니다.
    [securestring] $Password,

    # 설치가 필요할 때 쓰는 winget 패키지 ID. 목록이 바뀌면 이 값만 바꿔 주세요.
    # 확인: winget search PostgreSQL
    [string] $WingetId = 'PostgreSQL.PostgreSQL.18',

    # winget을 못 쓸 때 내려받아 둔 EDB 설치 프로그램(.exe) 경로.
    [string] $InstallerPath,

    # 덤프를 뜬 쪽이 18이므로 그보다 낮은 버전으로는 복원되지 않습니다.
    [int] $MinimumMajorVersion = 18,

    [switch] $Force,

    # 앱 설정 파일(collection-db.json)을 건드리지 않습니다.
    [switch] $SkipAppConfig
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 한글이 깨지지 않게. psql이 돌려주는 값도 UTF-8로 받습니다.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 }
catch { Write-Verbose '콘솔 인코딩을 바꾸지 못했습니다. 한글이 깨져 보일 수 있으나 동작에는 지장이 없습니다.' }
$env:PGCLIENTENCODING = 'UTF8'

$script:StepNumber = 0

function Write-Step {
    param([string] $Message)
    $script:StepNumber++
    Write-Host ''
    Write-Host ("[{0}] {1}" -f $script:StepNumber, $Message) -ForegroundColor Cyan
}

function Write-Ok {
    param([string] $Message)
    Write-Host ("    OK  {0}" -f $Message) -ForegroundColor Green
}

function Write-Note {
    param([string] $Message)
    Write-Host ("    - {0}" -f $Message) -ForegroundColor Gray
}

function Write-FailureAndExit {
    param([string] $Message, [string[]] $Hints = @())
    Write-Host ''
    Write-Host ("실패: {0}" -f $Message) -ForegroundColor Red
    foreach ($hint in $Hints) { Write-Host ("       {0}" -f $hint) -ForegroundColor Yellow }
    exit 1
}

<#
    네이티브 실행 파일은 예외를 던지지 않고 종료 코드만 남깁니다.
    호출마다 코드를 확인하지 않으면 실패한 복원이 성공으로 보입니다.
#>
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $Arguments = @(),
        [switch] $PassThruOutput,
        [switch] $AllowFailure
    )

    if ($PassThruOutput) {
        $output = & $FilePath @Arguments 2>&1
    }
    else {
        $output = & $FilePath @Arguments 2>&1
        if ($output) { $output | ForEach-Object { Write-Verbose $_ } }
    }

    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        $detail = if ($output) { ($output | Out-String).Trim() } else { '(출력 없음)' }
        throw ("{0} 실행이 코드 {1}로 끝났습니다.`n{2}" -f (Split-Path $FilePath -Leaf), $code, $detail)
    }

    return [pscustomobject]@{
        ExitCode = $code
        Output   = ($output | Out-String).Trim()
    }
}

<#
    설치된 PostgreSQL의 bin 폴더를 찾습니다. PATH에 잡혀 있으면 그것을,
    아니면 기본 설치 위치에서 가장 높은 버전을 씁니다. 설치 프로그램이
    PATH를 잡아 주지 않는 경우가 있어 두 곳을 모두 봅니다.
#>
function Find-PostgresBin {
    param([int] $MinimumMajor)

    $candidates = @()

    $onPath = Get-Command 'pg_restore.exe' -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += (Split-Path $onPath.Source -Parent) }

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $root) { continue }
        $base = Join-Path $root 'PostgreSQL'
        if (-not (Test-Path $base)) { continue }
        $candidates += (Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
            Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin' })
    }

    foreach ($bin in $candidates) {
        $restore = Join-Path $bin 'pg_restore.exe'
        if (-not (Test-Path $restore)) { continue }

        $version = Invoke-Native -FilePath $restore -Arguments @('--version') -PassThruOutput -AllowFailure
        if ($version.ExitCode -ne 0) { continue }
        if ($version.Output -notmatch '(\d+)(?:\.\d+)?') { continue }

        $major = [int]$Matches[1]
        if ($major -lt $MinimumMajor) {
            Write-Note ("{0} — 버전 {1}, {2} 미만이라 건너뜁니다." -f $bin, $major, $MinimumMajor)
            continue
        }

        return [pscustomobject]@{ Path = $bin; Major = $major }
    }

    return $null
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-PostgreSql {
    param([string] $WingetPackageId, [string] $Installer, [securestring] $Secret, [int] $ServerPort)

    # 설치만 관리자 권한을 요구합니다. 복원과 앱 설정은 일반 권한으로 됩니다.
    if (-not (Test-Administrator)) {
        Write-FailureAndExit 'PostgreSQL을 설치하려면 관리자 권한이 필요합니다.' @(
            '시작 메뉴에서 PowerShell을 오른쪽 클릭 → "관리자 권한으로 실행" 후 같은 명령을 다시 쓰세요.',
            '이미 설치되어 있는데 이 메시지가 나온다면, 설치된 버전이 요구 버전보다 낮은 것입니다.'
        )
    }

    if ($Installer) {
        if (-not (Test-Path $Installer)) {
            Write-FailureAndExit "설치 프로그램을 찾지 못했습니다: $Installer"
        }
        Write-Note '내려받아 둔 설치 프로그램으로 무인 설치합니다. 몇 분 걸립니다.'
        Invoke-Native -FilePath $Installer -Arguments @(
            '--mode', 'unattended',
            '--unattendedmodeui', 'minimal',
            '--superpassword', ([Net.NetworkCredential]::new('', $Secret).Password),
            '--serverport', "$ServerPort",
            '--disable-components', 'stackbuilder'
        ) | Out-Null
        return
    }

    $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-FailureAndExit 'PostgreSQL이 설치되어 있지 않고 winget도 없습니다.' @(
            'https://www.postgresql.org/download/windows/ 에서 설치 프로그램을 내려받은 뒤',
            '-InstallerPath "C:\경로\postgresql-18-windows-x64.exe" 를 붙여 다시 실행하세요.'
        )
    }

    Write-Note ("winget으로 {0} 을(를) 설치합니다. 몇 분 걸립니다." -f $WingetPackageId)
    $result = Invoke-Native -FilePath $winget.Source -Arguments @(
        'install', '--id', $WingetPackageId, '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements'
    ) -PassThruOutput -AllowFailure

    if ($result.ExitCode -ne 0) {
        Write-FailureAndExit ("winget 설치가 코드 {0}으로 끝났습니다." -f $result.ExitCode) @(
            '패키지 이름이 바뀌었을 수 있습니다. 아래로 확인한 뒤',
            '    winget search PostgreSQL',
            '-WingetId "찾은.패키지.ID" 를 붙여 다시 실행하세요.',
            '또는 설치 프로그램을 직접 받아 -InstallerPath 로 넘기세요.'
        )
    }

    # winget 설치 직후에는 이 세션의 PATH에 아직 반영되지 않습니다.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Wait-PostgresReady {
    param([string] $Bin, [int] $ServerPort, [int] $TimeoutSeconds = 90)

    $isReady = Join-Path $Bin 'pg_isready.exe'
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $probe = Invoke-Native -FilePath $isReady -Arguments @('-p', "$ServerPort") -PassThruOutput -AllowFailure
        if ($probe.ExitCode -eq 0) { return }
        Start-Sleep -Seconds 2
    }

    Write-FailureAndExit ("PostgreSQL이 {0}초 안에 응답하지 않았습니다 (포트 {1})." -f $TimeoutSeconds, $ServerPort) @(
        '서비스 앱에서 postgresql-x64-* 서비스가 실행 중인지 확인하세요.',
        '포트를 바꿔 설치했다면 -Port 로 알려 주세요.'
    )
}

<#
    덤프가 이 앱이 읽을 수 있는 것인지 복원 전에 봅니다. 형식이 틀리거나
    스키마 이력이 빠진 덤프는 복원해 봐야 앱이 수집을 켜지 않습니다.
#>
function Assert-DumpUsable {
    param([string] $Bin, [string] $Path)

    $listing = Invoke-Native -FilePath (Join-Path $Bin 'pg_restore.exe') `
        -Arguments @('--list', $Path) -PassThruOutput -AllowFailure

    if ($listing.ExitCode -ne 0) {
        Write-FailureAndExit '덤프 파일을 읽지 못했습니다.' @(
            '-Fc(커스텀 형식)로 뜬 덤프여야 합니다. 보내는 쪽에서 이렇게 뜨세요:',
            '    pg_dump -Fc --no-owner --no-privileges -d whisky_manager_collection -f collection.dump',
            $listing.Output
        )
    }

    if ($listing.Output -notmatch '__drizzle_migrations') {
        Write-FailureAndExit '덤프에 스키마 이력(drizzle 스키마)이 없습니다.' @(
            '이 덤프로 복원해도 앱은 수집을 켜지 않습니다.',
            '보내는 쪽에서 -n public 같은 스키마 한정 옵션 없이 다시 뜨세요.'
        )
    }

    foreach ($table in @('posts', 'boards', 'runs', 'feed_state')) {
        if ($listing.Output -notmatch [regex]::Escape($table)) {
            Write-FailureAndExit ("덤프에 {0} 표가 없습니다. 다른 데이터베이스의 덤프로 보입니다." -f $table)
        }
    }
}

function Invoke-Psql {
    param([string] $Bin, [string] $Database, [string] $Query, [int] $ServerPort, [string] $User)

    $result = Invoke-Native -FilePath (Join-Path $Bin 'psql.exe') -Arguments @(
        '-v', 'ON_ERROR_STOP=1', '-U', $User, '-p', "$ServerPort",
        '-d', $Database, '-tAc', $Query
    ) -PassThruOutput
    return $result.Output
}

function Write-AppConfig {
    param([string] $Database, [int] $ServerPort, [string] $User, [securestring] $Secret)

    $directory = Join-Path $env:APPDATA 'whisky-manager'
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $configPath = Join-Path $directory 'collection-db.json'

    if (Test-Path $configPath) {
        # 이미 있는 주소는 이 기계의 유일한 사본일 수 있습니다. 덮기 전에 남깁니다.
        $backup = "$configPath.bak"
        Copy-Item $configPath $backup -Force
        Write-Note ("기존 설정을 {0} 로 옮겨 뒀습니다." -f $backup)
    }

    # 비밀번호의 @ # / : 같은 글자는 주소 안에서 다른 뜻으로 읽힙니다.
    $escapedUser = [uri]::EscapeDataString($User)
    $escapedPassword = [uri]::EscapeDataString([Net.NetworkCredential]::new('', $Secret).Password)
    $url = "postgresql://${escapedUser}:${escapedPassword}@127.0.0.1:${ServerPort}/${Database}"

    $payload = [ordered]@{
        '_comment'    = '수집 DB 연결 문자열. Restore-CollectionDb.ps1이 작성했습니다.'
        'databaseUrl' = $url
    }
    $json = ($payload | ConvertTo-Json -Depth 3)

    # BOM 없는 UTF-8. 앱은 이 파일을 utf8로 읽습니다.
    [IO.File]::WriteAllText($configPath, $json + "`r`n", (New-Object Text.UTF8Encoding($false)))
    return $configPath
}

# --------------------------------------------------------------------------

Write-Host ''
Write-Host '수집 DB 이전 — PostgreSQL 설치 · 덤프 복원 · 앱 연결' -ForegroundColor White
Write-Host '----------------------------------------------------'

if (-not (Test-Path $DumpPath)) {
    Write-FailureAndExit "덤프 파일을 찾지 못했습니다: $DumpPath"
}
$DumpPath = (Resolve-Path $DumpPath).Path

if (-not $Password) {
    $Password = Read-Host -Prompt "PostgreSQL '$SuperUser' 계정의 비밀번호 (새로 설치하면 이 값으로 설정됩니다)" -AsSecureString
}
$plainPassword = [Net.NetworkCredential]::new('', $Password).Password
if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    Write-FailureAndExit '비밀번호가 비어 있습니다.'
}

try {
    # 자식 프로세스가 비밀번호를 묻지 않도록. finally에서 지웁니다.
    $env:PGPASSWORD = $plainPassword

    Write-Step 'PostgreSQL 확인'
    $postgres = Find-PostgresBin -MinimumMajor $MinimumMajorVersion
    if ($postgres) {
        Write-Ok ("이미 설치되어 있습니다 — 버전 {0}, {1}" -f $postgres.Major, $postgres.Path)
    }
    else {
        Write-Note ("버전 {0} 이상이 없습니다. 설치를 시작합니다." -f $MinimumMajorVersion)
        Install-PostgreSql -WingetPackageId $WingetId -Installer $InstallerPath `
            -Secret $Password -ServerPort $Port

        $postgres = Find-PostgresBin -MinimumMajor $MinimumMajorVersion
        if (-not $postgres) {
            Write-FailureAndExit '설치는 끝났는데 실행 파일을 찾지 못했습니다.' @(
                'PowerShell 창을 닫고 새로 열어 다시 실행해 보세요.',
                '그래도 같으면 설치 폴더를 확인하세요: C:\Program Files\PostgreSQL\<버전>\bin'
            )
        }
        Write-Ok ("설치 완료 — 버전 {0}, {1}" -f $postgres.Major, $postgres.Path)
    }
    $bin = $postgres.Path

    Write-Step '서버 응답 확인'
    Wait-PostgresReady -Bin $bin -ServerPort $Port
    Write-Ok ("포트 {0} 응답합니다." -f $Port)

    Write-Step '덤프 파일 확인'
    Assert-DumpUsable -Bin $bin -Path $DumpPath
    $sizeMb = [math]::Round((Get-Item $DumpPath).Length / 1MB, 2)
    Write-Ok ("{0} ({1} MB) — 스키마 이력과 네 개 표를 모두 담고 있습니다." -f (Split-Path $DumpPath -Leaf), $sizeMb)

    Write-Step '데이터베이스 준비'
    $exists = Invoke-Psql -Bin $bin -Database 'postgres' -ServerPort $Port -User $SuperUser `
        -Query "select 1 from pg_database where datname = '$DatabaseName'"

    if ($exists -eq '1') {
        $tables = Invoke-Psql -Bin $bin -Database $DatabaseName -ServerPort $Port -User $SuperUser `
            -Query "select count(*) from pg_tables where schemaname = 'public'"

        if ([int]$tables -gt 0 -and -not $Force) {
            Write-FailureAndExit ("'{0}' 데이터베이스에 이미 표 {1}개가 들어 있습니다." -f $DatabaseName, $tables) @(
                '지우고 새로 복원하려면 -Force 를 붙여 다시 실행하세요.',
                '그 데이터가 필요하다면 먼저 pg_dump 로 따로 보관하세요.'
            )
        }

        Write-Note ("기존 '{0}' 데이터베이스를 지우고 다시 만듭니다." -f $DatabaseName)
        Invoke-Native -FilePath (Join-Path $bin 'dropdb.exe') `
            -Arguments @('-U', $SuperUser, '-p', "$Port", $DatabaseName) | Out-Null
    }

    Invoke-Native -FilePath (Join-Path $bin 'createdb.exe') -Arguments @(
        '-U', $SuperUser, '-p', "$Port", '-E', 'UTF8', '-T', 'template0', $DatabaseName
    ) | Out-Null
    Write-Ok ("'{0}' 을(를) UTF8로 만들었습니다." -f $DatabaseName)

    Write-Step '복원'
    Write-Note '글 수에 따라 수십 초 걸립니다.'
    $restore = Invoke-Native -FilePath (Join-Path $bin 'pg_restore.exe') -Arguments @(
        '--no-owner', '-U', $SuperUser, '-p', "$Port", '-d', $DatabaseName, $DumpPath
    ) -PassThruOutput -AllowFailure

    if ($restore.ExitCode -ne 0) {
        Write-FailureAndExit ("복원이 코드 {0}으로 끝났습니다." -f $restore.ExitCode) @($restore.Output)
    }
    Write-Ok '복원했습니다.'

    Write-Step '내용 확인'
    $counts = Invoke-Psql -Bin $bin -Database $DatabaseName -ServerPort $Port -User $SuperUser -Query @'
select (select count(*) from posts) || '|' || (select count(*) from boards) || '|' ||
       (select count(*) from runs) || '|' || (select count(*) from feed_state)
'@
    $parts = $counts -split '\|'
    Write-Ok ("글 {0}건 · 게시판 {1}개 · 실행 {2}건 · 작업상태 {3}건" -f $parts[0], $parts[1], $parts[2], $parts[3])

    $migration = Invoke-Psql -Bin $bin -Database $DatabaseName -ServerPort $Port -User $SuperUser `
        -Query 'select hash from drizzle.__drizzle_migrations order by created_at desc limit 1'

    if ([string]::IsNullOrWhiteSpace($migration)) {
        Write-FailureAndExit '스키마 이력이 비어 있습니다. 앱이 수집을 켜지 않습니다.' @(
            '덤프를 다시 뜨되 스키마 한정 옵션 없이 전체를 담으세요.'
        )
    }
    Write-Ok ("스키마 이력 {0}…" -f $migration.Substring(0, [Math]::Min(12, $migration.Length)))

    $span = Invoke-Psql -Bin $bin -Database $DatabaseName -ServerPort $Port -User $SuperUser `
        -Query "select to_char(min(posted_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') || ' ~ ' || to_char(max(posted_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') from posts"
    if (-not [string]::IsNullOrWhiteSpace($span)) {
        Write-Ok ("수집 구간 {0} (KST)" -f $span)
    }

    if ($SkipAppConfig) {
        Write-Step '앱 설정 — 건너뜁니다'
        Write-Note '트레이 메뉴의 "수집 저장소 설정 열기"로 직접 적어 주세요.'
    }
    else {
        Write-Step '앱 설정'
        $configPath = Write-AppConfig -Database $DatabaseName -ServerPort $Port -User $SuperUser -Secret $Password
        Write-Ok $configPath
        Write-Note '비밀번호가 이 파일에 평문으로 들어갑니다. 이 계정의 파일 접근 권한에 기대는 구조입니다.'
    }

    Write-Host ''
    Write-Host '끝났습니다.' -ForegroundColor Green
    Write-Host '  Whisky Manager를 완전히 종료했다가 다시 켜고, 수집 현황 화면을 여세요.' -ForegroundColor White
    Write-Host '  "수집 저장소를 쓸 수 없습니다"가 보이면 %APPDATA%\whisky-manager\collection-status.log 를 확인하세요.' -ForegroundColor White
    Write-Host ''
}
catch {
    Write-FailureAndExit $_.Exception.Message
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
