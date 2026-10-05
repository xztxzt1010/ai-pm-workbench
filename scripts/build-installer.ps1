$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TauriRoot = Join-Path $ProjectRoot "src-tauri"
$BundleRoot = Join-Path $TauriRoot "target\release\bundle\nsis"
$ManifestPath = Join-Path $BundleRoot "installer-manifest.json"
$AcceptanceDraftPath = Join-Path $BundleRoot "release-acceptance.draft.json"
$TargetTriple = if ($env:TAURI_ENV_TARGET_TRIPLE) { $env:TAURI_ENV_TARGET_TRIPLE } else { "x86_64-pc-windows-msvc" }
$SidecarPath = Join-Path $ProjectRoot "sidecar\bin\apm-sidecar-$TargetTriple.exe"

Push-Location $ProjectRoot
try {
    Write-Host "Building the self-contained Sidecar, production frontend, and NSIS installer..."
    npm run verify:installer-config
    npm run tauri -- build --bundles nsis
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri NSIS build failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $SidecarPath -PathType Leaf)) {
        throw "The self-contained Sidecar was not produced at $SidecarPath"
    }
    npm run sidecar:verify

    $installer = Get-ChildItem -LiteralPath $BundleRoot -Filter "*.exe" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) {
        throw "No NSIS installer was produced in $BundleRoot"
    }

    $hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $installerSize = $installer.Length
    $sidecarHash = (Get-FileHash -LiteralPath $SidecarPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecarSize = (Get-Item -LiteralPath $SidecarPath).Length
    $manifest = [ordered]@{
        product = "Assistant Product Manager"
        version = (Get-Content (Join-Path $TauriRoot "tauri.conf.json") -Raw | ConvertFrom-Json).version
        installer = $installer.Name
        installerSizeBytes = $installerSize
        sha256 = $hash
        sidecar = [ordered]@{
            file = (Split-Path -Leaf $SidecarPath)
            relativePath = "sidecar/bin/$(Split-Path -Leaf $SidecarPath)"
            sha256 = $sidecarHash
            sizeBytes = $sidecarSize
            selfContained = $true
        }
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        acceptance = "manual-install-required"
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
    node scripts/verify-release-manifest.mjs --manifest $ManifestPath --project-root $ProjectRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Release manifest verification failed with exit code $LASTEXITCODE"
    }
    node scripts/verify-release-acceptance.mjs --create-draft $AcceptanceDraftPath --manifest $ManifestPath --project-root $ProjectRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Release acceptance draft creation failed with exit code $LASTEXITCODE"
    }
    Write-Host "Installer: $($installer.FullName)"
    Write-Host "SHA-256: $hash"
    Write-Host "Sidecar SHA-256: $sidecarHash"
    Write-Host "Manifest: $ManifestPath"
    Write-Host "Acceptance draft (must be completed on a clean Windows machine): $AcceptanceDraftPath"
}
finally {
    Pop-Location
}
