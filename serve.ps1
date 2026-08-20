$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5500

if ($env:MEDIPOINT_WEB_PORT) {
    $port = [int]$env:MEDIPOINT_WEB_PORT
}

Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot 'images'))) {
    Write-Host 'Warning: the images folder is missing from this project.' -ForegroundColor Yellow
    Write-Host 'Pages will load, but logos and background photos may be absent.' -ForegroundColor Yellow
    Write-Host 'Copy the images folder from the full MediPoint project into the repo root if you have it.' -ForegroundColor Yellow
    Write-Host ''
}

Write-Host "Serving MediPoint at http://127.0.0.1:$port/front/welcome.html" -ForegroundColor Green
Write-Host 'Press Ctrl+C to stop.' -ForegroundColor Cyan

python -m http.server $port
