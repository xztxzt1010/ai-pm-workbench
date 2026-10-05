$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot 'scripts\start-workbench.ps1'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "Launcher script not found: $launcher"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Assistant Product Manager.lnk'
$shell = New-Object -ComObject WScript.Shell

# Remove only shortcuts created by the previous launcher; leave unrelated desktop shortcuts untouched.
Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -File | ForEach-Object {
  $existing = $shell.CreateShortcut($_.FullName)
  if ($existing.Arguments -like '*START_MANUAL_TEST.cmd*' -or $existing.Arguments -like '*start-workbench.ps1*') {
    Remove-Item -LiteralPath $_.FullName -Force
  }
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Start Assistant Product Manager workbench'
$debugApp = Join-Path $projectRoot "src-tauri\target\debug\app.exe"
$fallbackIcon = Join-Path $env:WINDIR "System32\shell32.dll"
$shortcut.IconLocation = if (Test-Path -LiteralPath $debugApp -PathType Leaf) { "$debugApp,0" } else { "$fallbackIcon,220" }
$shortcut.Save()

Write-Output "Shortcut created: $shortcutPath"
