@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-exe.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] exit code %errorlevel%
  pause
)
endlocal