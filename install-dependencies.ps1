$ErrorActionPreference = 'Stop'

Write-Host 'Checking for Python...' -ForegroundColor Cyan
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error 'Python was not found. Install Python 3 from https://www.python.org/downloads/windows/'
    exit 1
}

Write-Host 'Checking for Deno...' -ForegroundColor Cyan
if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
    Write-Host 'Deno was not found. Installing via winget...' -ForegroundColor Yellow
    winget install --id DenoLand.Deno -e
}

Write-Host 'Checking for Supabase CLI...' -ForegroundColor Cyan
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host 'Supabase CLI was not found. Installing via winget...' -ForegroundColor Yellow
    winget install --id Supabase.supabase -e
}

Write-Host 'Python version:' -ForegroundColor Green
python --version

Write-Host 'Deno version:' -ForegroundColor Green
deno --version

Write-Host 'Supabase CLI version:' -ForegroundColor Green
supabase --version

Write-Host 'Dependency setup complete.' -ForegroundColor Green
