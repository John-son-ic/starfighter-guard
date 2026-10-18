@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 请先安装 Node.js 24。
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo 缺少依赖，请在本目录运行 npm ci。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo 缺少游戏构建，请在本目录运行 npm run build。
  pause
  exit /b 1
)
node scripts/serve-duel.mjs --open
if errorlevel 1 pause
endlocal
