<#
Restores this backup on Windows: installs PostgreSQL 18 (if missing), recreates the
collection database, and puts the app DB and settings under %APPDATA%\whisky-manager.
Quit Whisky Manager first. Run from this folder:
  powershell -ExecutionPolicy Bypass -File .\restore.ps1
Optional: -DatabasePassword <text>  password for the collection DB role (random if omitted)
#>
param(
    [string]$DatabasePassword
)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $env:APPDATA 'whisky-manager'
$pgMajor = 18
$pgPort = 5432
$wingetId = "PostgreSQL.PostgreSQL.$pgMajor"

function New-Password {
    -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
}

function Find-PgBin {
    $bin = Join-Path $env:ProgramFiles "PostgreSQL\$pgMajor\bin"
    if (Test-Path (Join-Path $bin 'pg_restore.exe')) { return $bin }
    return $null
}

function Invoke-Psql([string]$bin, [string]$database, [string]$sql) {
    & (Join-Path $bin 'psql.exe') -h 127.0.0.1 -p $pgPort -U postgres -d $database -v ON_ERROR_STOP=1 -Atc $sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
}

if (Test-Path (Join-Path $appDir 'whisky-manager.db')) {
    throw "Refusing to overwrite $appDir\whisky-manager.db - move it aside first."
}
if (Get-Process -Name 'Whisky Manager' -ErrorAction SilentlyContinue) {
    throw 'Whisky Manager is running. Quit it first.'
}

$backupUrl = [Uri](Get-Content (Join-Path $here 'settings\collection-db.json') -Raw -Encoding UTF8 | ConvertFrom-Json).databaseUrl
$roleName = $backupUrl.UserInfo.Split(':')[0]
$databaseName = $backupUrl.AbsolutePath.TrimStart('/')
if (-not $roleName -or -not $databaseName) { throw 'collection-db.json has no user or database name.' }

$superPassword = $null
$bin = Find-PgBin
if (-not $bin) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "winget not found. Install PostgreSQL $pgMajor from https://www.postgresql.org/download/windows/ and rerun."
    }
    $superPassword = New-Password
    Write-Host "Installing PostgreSQL $pgMajor via winget..."
    winget install --exact --id $wingetId --accept-package-agreements --accept-source-agreements `
        --override "--mode unattended --unattendedmodeui none --superpassword $superPassword --serverport $pgPort"
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL install failed.' }
    $bin = Find-PgBin
    if (-not $bin) { throw "PostgreSQL $pgMajor bin folder not found after install." }
    Write-Host "postgres superuser password (save it, shown once): $superPassword"
}
else {
    $secure = Read-Host 'Existing PostgreSQL found. Enter the postgres superuser password' -AsSecureString
    $superPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$env:PGPASSWORD = $superPassword

$ready = $false
foreach ($attempt in 1..30) {
    & (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $pgPort | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'PostgreSQL server did not become ready.' }

if (-not $DatabasePassword) { $DatabasePassword = New-Password }
$sqlPassword = $DatabasePassword.Replace("'", "''")
$roleExists = Invoke-Psql $bin 'postgres' "select 1 from pg_roles where rolname = '$roleName'"
if ($roleExists) {
    Invoke-Psql $bin 'postgres' "alter role `"$roleName`" with login password '$sqlPassword'"
}
else {
    Invoke-Psql $bin 'postgres' "create role `"$roleName`" with login password '$sqlPassword'"
}
$databaseExists = Invoke-Psql $bin 'postgres' "select 1 from pg_database where datname = '$databaseName'"
if ($databaseExists) { throw "Database $databaseName already exists - drop it first." }
Invoke-Psql $bin 'postgres' "create database `"$databaseName`" owner `"$roleName`""

& (Join-Path $bin 'pg_restore.exe') -h 127.0.0.1 -p $pgPort -U postgres --no-owner --no-privileges `
    --role $roleName --dbname $databaseName (Join-Path $here 'collection.pgdump')
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed.' }

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $here 'whisky-manager.db') (Join-Path $appDir 'whisky-manager.db')

$encodedPassword = [Uri]::EscapeDataString($DatabasePassword)
$newUrl = "postgresql://${roleName}:${encodedPassword}@127.0.0.1:${pgPort}/${databaseName}"
$configJson = @{ databaseUrl = $newUrl } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $appDir 'collection-db.json'), $configJson, (New-Object Text.UTF8Encoding($false)))

Remove-Item Env:PGPASSWORD
Write-Host "Done. App DB and collection-db.json are in $appDir; collection DB '$databaseName' restored."
$manifest = Get-Content (Join-Path $here 'MANIFEST.txt') -Encoding UTF8
$appVersion = ($manifest | Where-Object { $_ -like 'app version:*' }) -replace '^app version:\s*', ''
$schema = ($manifest | Where-Object { $_ -like 'collection schema:*' }) -replace '^collection schema:\s*', ''
Write-Host "Install Whisky Manager $appVersion (or newer) from the GitHub release .msi, then launch it."
Write-Host "The app refuses a collection DB whose latest migration is not its own; this backup is at $schema."
