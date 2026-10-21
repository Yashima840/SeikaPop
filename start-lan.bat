@echo off
rem Double-click to open SeikaPop and allow phones on the same Wi-Fi (close this window to stop).
cd /d "%~dp0"
python tools\serve.py --lan %*
if errorlevel 1 pause
