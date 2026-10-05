$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 1420

function Test-WorkbenchPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $port)
    if (-not $task.Wait(250)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

if (-not (Test-WorkbenchPort)) {
  Start-Process -FilePath $env:ComSpec `
    -ArgumentList '/c', 'npm run dev -- --host 127.0.0.1' `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    if (Test-WorkbenchPort) { break }
  }
}

if (-not (Test-WorkbenchPort)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Workbench failed to start. Check Node.js and project dependencies.', 'Assistant Product Manager') | Out-Null
  exit 1
}

$workbenchUrl = 'http://127.0.0.1:1420/'
$edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
)
$edge = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if ($edge) {
  Start-Process -FilePath $edge -ArgumentList "--app=$workbenchUrl", '--start-maximized'
} else {
  Start-Process $workbenchUrl
}
