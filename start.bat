@echo off
rem Double-click to open SeikaPop on this PC (close this window to stop).
cd /d "%~dp0"
python tools\serve.py %*
if errorlevel 1 pause
