@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 24 LTS：https://nodejs.org/
  echo 本工具不会自动下载或安装任何东西。
  pause
  exit /b 1
)
echo 正在启动本地试玩服务（仅监听 127.0.0.1）。请保持本窗口打开。
echo 如果提示端口被占用，可在本目录执行：node scripts\serve-release.mjs --port 5175
echo.
node scripts\serve-release.mjs %*
set EXITCODE=%errorlevel%
echo.
if not "%EXITCODE%"=="0" (
  echo 服务未能启动，退出码 %EXITCODE%。请把上面的完整输出反馈给开发方。
) else (
  echo 服务已停止。
)
pause
exit /b %EXITCODE%
