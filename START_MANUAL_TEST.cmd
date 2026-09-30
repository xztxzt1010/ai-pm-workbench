@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if not exist "node_modules" (
  echo Frontend dependencies are missing. Run npm install first.
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:"127.0.0.1:1420 .*LISTENING" >nul
if not errorlevel 1 goto ready

start "Assistant Product Manager - Vite" /D "%~dp0" cmd /k npm run dev -- --host 127.0.0.1

for /L %%I in (1,1,20) do (
  netstat -ano | findstr /R /C:"127.0.0.1:1420 .*LISTENING" >nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo Vite did not become ready on http://127.0.0.1:1420/
echo Check the Vite console window for the error.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:1420/"
echo Manual test page: http://127.0.0.1:1420/
echo Close the Vite console window to stop the preview.
endlocal
