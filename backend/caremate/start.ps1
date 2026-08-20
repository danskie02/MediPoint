$ErrorActionPreference = 'Stop'

function Test-PortAvailable {
    param([int]$Port)

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

function Get-AvailablePort {
    param([int]$PreferredPort = 8000)

    for ($port = $PreferredPort; $port -le ($PreferredPort + 20); $port++) {
        if (Test-PortAvailable -Port $port) {
            return $port
        }
    }

    throw "No open port found between $PreferredPort and $($PreferredPort + 20)."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'

Set-Location $scriptDir

if ($env:VIRTUAL_ENV -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $pythonCommand = 'python'
} elseif (Test-Path $venvPython) {
    $pythonCommand = $venvPython
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCommand = 'python'
} else {
    Write-Error 'Python was not found. Run .\install-dependencies.ps1 first.'
    exit 1
}

$preferredPort = 8000
if ($env:CAREMATE_PORT) {
    $preferredPort = [int]$env:CAREMATE_PORT
}

$port = Get-AvailablePort -PreferredPort $preferredPort
$url = "http://127.0.0.1:$port"

if ($port -ne $preferredPort) {
    Write-Host "Port $preferredPort is already in use. Using $port instead." -ForegroundColor Yellow
    Write-Host "Set window.MEDIPOINT_CAREMATE_URL = '$url' in medipoint-config.js if needed." -ForegroundColor Yellow
}

Write-Host "Starting CareMate API on $url" -ForegroundColor Green
& $pythonCommand -m uvicorn main:app --host 127.0.0.1 --port $port --reload
