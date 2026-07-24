$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$front = Join-Path $root 'front'
$issues = [System.Collections.Generic.List[string]]::new()

Get-ChildItem $front -Recurse -Filter '*.html' | ForEach-Object {
    $file = $_
    $content = Get-Content $file.FullName -Raw

    $ids = [regex]::Matches($content, '\sid="([^"]+)"') | ForEach-Object {
        $_.Groups[1].Value
    }

    $ids | Group-Object | Where-Object Count -gt 1 | ForEach-Object {
        $issues.Add("Duplicate id '$($_.Name)' in $($file.FullName)")
    }

    [regex]::Matches($content, '(?:href|src)="([^"]+)"') | ForEach-Object {
        $reference = $_.Groups[1].Value
        if ($reference -match '^(https?:|#|data:|mailto:|tel:)') { return }

        $cleanReference = ($reference -split '[?#]')[0]
        if (-not $cleanReference) { return }

        $target = Join-Path $file.DirectoryName $cleanReference
        if (-not (Test-Path $target)) {
            $issues.Add("Missing reference '$reference' in $($file.FullName)")
        }
    }

    foreach ($tag in @('div', 'section')) {
        $openCount = ([regex]::Matches($content, "<$tag(?=\s|>)")).Count
        $closeCount = ([regex]::Matches($content, "</$tag>")).Count
        if ($openCount -ne $closeCount) {
            $issues.Add("Unbalanced <$tag> tags in $($file.FullName): $openCount/$closeCount")
        }
    }
}

Get-ChildItem $front -Recurse -File | Where-Object Length -eq 0 | ForEach-Object {
    $issues.Add("Empty file: $($_.FullName)")
}

Get-ChildItem $front -Recurse -Include '*.js', '*.html' -File |
    Where-Object { $_.Name -notin @('shared.js', 'qrcode.min.js') } |
    Select-String -Pattern 'JSON\.parse|localStorage\.(getItem|setItem)' |
    ForEach-Object {
        $issues.Add("Direct unsafe storage access at $($_.Path):$($_.LineNumber)")
    }

if ($issues.Count -gt 0) {
    $issues | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'MediPoint static checks passed.' -ForegroundColor Green
