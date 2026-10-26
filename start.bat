@echo off
rem Double-click to open the SeikaPop workspace without a console window.
rem To stop it, press the stop button on the workspace page.
cd /d "%~dp0"
where pythonw >nul 2>nul
if not errorlevel 1 (
  start "" pythonw tools\serve.py %*
  exit /b
)
rem pythonw not found: run with a console window (close it to stop)
python tools\serve.py %*
if errorlevel 1 pause
