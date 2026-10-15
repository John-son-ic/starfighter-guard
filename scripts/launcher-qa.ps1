param([Parameter(Mandatory = $true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$packagePath = (Resolve-Path -LiteralPath $PackageDirectory).Path
$launcherPath = Join-Path $packagePath 'start-play.cmd'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw 'Missing packaged start-play.cmd' }
$reservation = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$reservation.Start()
$port = $reservation.LocalEndpoint.Port
$reservation.Stop()
$launchedProcess = $null
$response = $null
try {
  # Shell association is the same Windows mechanism Explorer uses for a .cmd file.
  # Hidden window avoids leaving an interactive test console on the user's desktop.
  $launchedProcess = Start-Process -FilePath $launcherPath -ArgumentList @('--port', "$port") -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    try { $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -TimeoutSec 1 -NoProxy; break }
    catch { Start-Sleep -Milliseconds 100 }
  }
  if ($null -eq $response -or $response.StatusCode -ne 200 -or $response.Content -notmatch 'id="app"') { throw 'The shell-associated launcher did not serve the game' }
} finally {
  if ($null -ne $launchedProcess -and -not $launchedProcess.HasExited) {
    & taskkill.exe /PID $launchedProcess.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the test-owned launcher process tree' }
  }
}
$client = [System.Net.Sockets.TcpClient]::new()
$stopped = $false
try { $client.Connect('127.0.0.1', $port) } catch { $stopped = $true } finally { $client.Dispose() }
if (-not $stopped) { throw 'The test-owned listener remained after stopping its process tree' }
$result = [ordered]@{ method = 'Windows shell file association via Start-Process'; packagePath = $packagePath; port = $port; httpStatus = [int]$response.StatusCode; stopped = $stopped; note = 'Automated shell association execution, not a human mouse double-click or manual console-close test.' }
$outputDirectory = Join-Path $PSScriptRoot '../artifacts/c04-release'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDirectory 'launcher-checks.json') -Encoding utf8
$result | ConvertTo-Json -Compress
