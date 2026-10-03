# Share the Frenymies online test with friends over the internet, through a temporary Cloudflare link.
#
# What it does: starts the game server (if it is not running yet), builds the game page, serves it on
# port 5191, opens a Cloudflare quick tunnel to it, picks a random room code, copies the invite link
# and opens it in your browser. Keep this window open while you play. Press Enter (or close the
# window) to stop sharing. The link is different every time.
#
# Run: Play-Frenymies-Online.cmd share   (or the "Share Frenymies Online" Desktop shortcut)
# -Vercel: open and copy the link to the game page on Vercel instead (same room, same laptop server).
# -Test: no browser, no clipboard; stops when a file named "stop" appears in %TEMP%\frenymies-share
#        (or after 10 minutes). For automated checks.
# Both links are always saved in %TEMP%\frenymies-share (link.txt and vercel-link.txt).
param([switch]$Test, [switch]$Vercel)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logs = Join-Path $env:TEMP 'frenymies-share'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
Remove-Item (Join-Path $logs 'link.txt'), (Join-Path $logs 'vercel-link.txt') -ErrorAction SilentlyContinue

function Test-Port($port) {
  try { (New-Object Net.Sockets.TcpClient('localhost', $port)).Close(); return $true } catch { return $false }
}
function Wait-Port($port, $what) {
  for ($i = 0; $i -lt 60; $i++) { if (Test-Port $port) { return }; Start-Sleep -Milliseconds 500 }
  throw "$what did not start. Logs are in $logs"
}
function Start-Quiet($file, $arguments, $name) {
  # Runs inside this window (no extra windows), so everything stops when this window closes.
  Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$name.out.log") -RedirectStandardError (Join-Path $logs "$name.err.log")
}

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe' }
if (-not (Test-Path $cloudflared)) {
  Write-Host 'Cloudflare tunnel (cloudflared) is not installed. In PowerShell run:'
  Write-Host '  winget install --id Cloudflare.cloudflared'
  Read-Host 'Press Enter to close'
  exit 1
}

$mine = @()
try {
  if (-not (Test-Port 3100)) {
    Write-Host 'Starting the game server...'
    $mine += Start-Quiet 'node' @('server\src\index.ts') 'server'
    Wait-Port 3100 'The game server'
  }

  Write-Host 'Building the game page...'
  & node node_modules\vite\bin\vite.js build client --logLevel error
  if ($LASTEXITCODE -ne 0) { throw 'The game page did not build.' }

  if (Test-Port 5191) { throw 'Port 5191 is busy. Is another share window still open? Close it and try again.' }
  $mine += Start-Quiet 'node' @('node_modules\vite\bin\vite.js', 'preview', 'client', '--port', '5191', '--strictPort') 'page'
  Wait-Port 5191 'The game page'

  Write-Host 'Opening a Cloudflare link (takes a few seconds)...'
  $tunnelLog = Join-Path $logs 'tunnel.err.log'
  $mine += Start-Quiet $cloudflared @('tunnel', '--no-autoupdate', '--url', 'http://localhost:5191') 'tunnel'
  $url = $null
  for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $tunnelLog) {
      $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }
  if (-not $url) { throw "Cloudflare did not give a link. See $tunnelLog" }

  # a new link needs a moment before it works everywhere
  for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep -Seconds 2 }
  }

  $letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
  $room = -join (1..4 | ForEach-Object { $letters | Get-Random })
  $link = "$url/?room=$room"
  # the same room through the game page on Vercel: the page comes from Vercel, the game from this laptop
  $tunnelHost = ([Uri]$url).Host
  $vercelLink = "https://frenymies.vercel.app/?server=wss://$tunnelHost/ws&room=$room"
  Set-Content -Path (Join-Path $logs 'link.txt') -Value $link
  Set-Content -Path (Join-Path $logs 'vercel-link.txt') -Value $vercelLink
  if ($Test) {
    $stop = Join-Path $logs 'stop'
    Remove-Item $stop -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 600 -and -not (Test-Path $stop); $i++) { Start-Sleep -Seconds 1 }
    return
  }
  $open = if ($Vercel) { $vercelLink } else { $link }
  Set-Clipboard -Value $open
  Start-Process $open

  Write-Host ''
  Write-Host '  Frenymies is shared. Send this link to your friends (it is already copied):' -ForegroundColor Green
  Write-Host ''
  Write-Host "  $open" -ForegroundColor Yellow
  Write-Host ''
  if ($Vercel) { Write-Host '  The same room straight from this laptop (if the Vercel page gives trouble):' }
  else { Write-Host '  Or the same room through the game page on Vercel (to test that page):' }
  Write-Host "  $(if ($Vercel) { $link } else { $vercelLink })" -ForegroundColor Yellow
  Write-Host ''
  Write-Host "  Room code: $room. Up to 4 players. Keep this window open while you play."
  Write-Host '  The link stops working when you stop sharing, and is different next time.'
  Write-Host ''
  Read-Host '  Press Enter to stop sharing'
}
catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (-not $Test) { Read-Host 'Press Enter to close' }
}
finally {
  foreach ($p in $mine) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
