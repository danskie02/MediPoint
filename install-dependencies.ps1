$ErrorActionPreference = 'Stop'

function Refresh-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

function Find-Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $searchRoots = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
        "$env:ProgramFiles",
        "$env:ProgramFiles (x86)",
        "$env:USERPROFILE\.deno\bin",
        "$env:LOCALAPPDATA\deno",
        "$env:USERPROFILE\scoop\shims"
    )

    foreach ($root in $searchRoots) {
        if (-not (Test-Path $root)) {
            continue
        }

        $match = Get-ChildItem -Path $root -Recurse -Filter "$Name.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1

        if ($match) {
            $directory = Split-Path $match.FullName -Parent
            if ($env:Path -notlike "*$directory*") {
                $env:Path = "$directory;$env:Path"
            }
            return $match.FullName
        }
    }

    return $null
}

function Show-OptionalToolStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [string]$Path,
        [string]$InstallHint
    )

    if ($Path) {
        Write-Host "$Label version:" -ForegroundColor Green
        & $Path --version
        return
    }

    Write-Host "$Label was not found on PATH." -ForegroundColor Yellow
    Write-Host $InstallHint -ForegroundColor DarkYellow
}

Write-Host 'Checking for Python...' -ForegroundColor Cyan
$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if ($env:VIRTUAL_ENV -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $pythonCommand = 'python'
} elseif (Test-Path $venvPython) {
    $pythonCommand = $venvPython
    Write-Host "Using project virtual environment: $venvPython" -ForegroundColor Green
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCommand = 'python'
} else {
    Write-Error 'Python was not found. Install Python 3 from https://www.python.org/downloads/windows/'
    exit 1
}

Refresh-SessionPath

Write-Host 'Checking for Deno...' -ForegroundColor Cyan
$denoPath = Find-Executable -Name 'deno'
if (-not $denoPath) {
    Write-Host 'Deno was not found. Installing via winget...' -ForegroundColor Yellow
    winget install --id DenoLand.Deno -e --accept-package-agreements --accept-source-agreements
    Refresh-SessionPath
    $denoPath = Find-Executable -Name 'deno'
}

Write-Host 'Checking for Supabase CLI...' -ForegroundColor Cyan
$supabasePath = Find-Executable -Name 'supabase'
if (-not $supabasePath) {
    Write-Host 'Supabase CLI was not found. Installing via winget...' -ForegroundColor Yellow
    winget install --id Supabase.CLI -e --accept-package-agreements --accept-source-agreements 2>$null
    if ($LASTEXITCODE -ne 0) {
        winget install --id Supabase.supabase -e --accept-package-agreements --accept-source-agreements 2>$null
    }
    Refresh-SessionPath
    $supabasePath = Find-Executable -Name 'supabase'
}

Write-Host 'Python version:' -ForegroundColor Green
& $pythonCommand --version

Show-OptionalToolStatus -Label 'Deno' -Path $denoPath -InstallHint 'Install Deno manually: winget install DenoLand.Deno, then restart PowerShell.'
Show-OptionalToolStatus -Label 'Supabase CLI' -Path $supabasePath -InstallHint 'Install Supabase CLI manually: https://supabase.com/docs/guides/cli/getting-started'

Write-Host 'Installing CareMate Python dependencies...' -ForegroundColor Cyan
$requirementsPath = Join-Path $PSScriptRoot 'backend\caremate\requirements.txt'
$pipArgs = @('-m', 'pip', 'install', '-r', $requirementsPath)

try {
    & $pythonCommand @pipArgs
    if ($LASTEXITCODE -ne 0) {
        throw "pip exited with code $LASTEXITCODE"
    }
} catch {
    Write-Host 'Primary pip install failed. Retrying with --user...' -ForegroundColor Yellow
    & $pythonCommand -m pip install --user -r $requirementsPath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Unable to install CareMate Python dependencies. Activate .venv and run: python -m pip install -r backend\caremate\requirements.txt"
        exit 1
    }
}

Write-Host 'Dependency setup complete.' -ForegroundColor Green
Write-Host 'Start CareMate with: .\backend\caremate\start.ps1' -ForegroundColor Cyan
