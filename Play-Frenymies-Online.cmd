@echo off
rem One-click launcher for the online test (milestone 2).
rem Starts the game server (port 3100) and the game page (port 5190) if they are not running yet,
rem then opens the game. Add "bots" to also start 3 test bots in room TEST:
rem   Play-Frenymies-Online.cmd bots
rem Closing the minimized windows stops them. ("nobrowser" starts everything without opening the game.)
rem "share" instead puts the game on a temporary Cloudflare link for friends (see tools\share.ps1).
rem "deploy" checks the code and updates the game page on Vercel (see tools\deploy.ps1).
setlocal
cd /d "%~dp0"
if /i "%~1"=="share" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\share.ps1"
  exit /b %errorlevel%
)
if /i "%~1"=="deploy" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\deploy.ps1"
  exit /b %errorlevel%
)
set URL=http://localhost:5190/?room=TEST

call :isup 3100
if %errorlevel%==0 goto client
echo Starting the Frenymies game server...
start "Frenymies game server" /min cmd /c "node server\src\index.ts"

:client
call :isup 5190
if %errorlevel%==0 goto waitall
echo Starting the Frenymies game page...
start "Frenymies game page" /min cmd /c "node node_modules\vite\bin\vite.js client --port 5190 --strictPort"

:waitall
set tries=0
:wait
call :isup 3100
if not %errorlevel%==0 goto again
call :isup 5190
if %errorlevel%==0 goto ready
:again
ping -n 2 127.0.0.1 >nul
set /a tries+=1
if %tries% lss 30 goto wait
echo Something did not start. Check the minimized "Frenymies" windows for errors.
pause
exit /b 1

:ready
if /i "%~1"=="bots" start "Frenymies bots" /min cmd /c "node tools\bots.ts 3 TEST"
start "" %URL%
exit /b 0

:isup
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('localhost', %1)).Close(); exit 0 } catch { exit 1 }"
exit /b %errorlevel%
