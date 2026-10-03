@echo off
rem One-click launcher: starts the game server if it is not running yet, then opens the game.
rem Closing the minimized "Frenymies server" window stops the server.
setlocal
cd /d "%~dp0"
set PORT=5188
set URL=http://localhost:%PORT%

call :isup
if %errorlevel%==0 goto open

echo Starting the Frenymies server...
start "Frenymies server" /min cmd /c "node node_modules\vite\bin\vite.js --port %PORT% --strictPort"

set tries=0
:wait
ping -n 2 127.0.0.1 >nul
call :isup
if %errorlevel%==0 goto open
set /a tries+=1
if %tries% lss 30 goto wait
echo The server did not start. Check the "Frenymies server" window for errors.
pause
exit /b 1

:open
if /i "%~1"=="nobrowser" exit /b 0
start "" %URL%
exit /b 0

:isup
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('localhost', %PORT%)).Close(); exit 0 } catch { exit 1 }"
exit /b %errorlevel%
