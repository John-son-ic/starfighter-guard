@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS first.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed. Keep this output for the agent.
    pause
    exit /b 1
  )
)
echo Starting the flight prototype. Close this window to stop the server.
call npm.cmd run dev -- --open
if errorlevel 1 pause
