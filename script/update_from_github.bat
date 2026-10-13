@echo off
rem Gets the newest version Claude committed to GitHub (run after upload_to_github.bat worked once).
cd /d "%~dp0.."
git pull origin main
if errorlevel 1 (echo Update FAILED - send a screenshot of this window.) else (echo Up to date.)
pause
