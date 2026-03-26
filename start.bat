@echo off
chcp 65001 >nul 2>&1
title FTree - 家谱管理系统

echo ========================================
echo   FTree 家谱管理系统 启动中...
echo ========================================
echo.

cd /d "%~dp0"

:: 编译并启动后端服务器（后台运行）
echo [1/2] 启动后端服务...
start "" /b node start-server.js > _server.log 2>&1

:: 等待后端启动
echo      等待后端服务就绪...
set /a retries=0
:wait_loop
if %retries% geq 15 (
  echo      后端启动超时，请检查 _server.log
  goto start_frontend
)
timeout /t 1 /nobreak >nul
findstr /c:"server running" _server.log >nul 2>&1
if errorlevel 1 (
  set /a retries+=1
  goto wait_loop
)
echo      后端服务已启动!
echo.

:start_frontend
:: 启动前端开发服务器
echo [2/2] 启动前端服务...
echo.
echo ========================================
echo   启动完成！请在浏览器中访问:
echo   http://localhost:5173
echo ========================================
echo.
echo   按 Ctrl+C 可停止所有服务
echo.

npx vite
