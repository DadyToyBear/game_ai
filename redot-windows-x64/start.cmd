@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0redot-bridge\desktop_launcher.py" %*
) else (
  python "%~dp0redot-bridge\desktop_launcher.py" %*
)
if errorlevel 1 exit /b 1
