@echo off
rem Starts the game: serves the "wow excel" folder (the one that holds the game folder) and opens it in the browser.
cd /d "%~dp0"
if not exist "game\index.html" cd ..
if not exist "game\index.html" (echo Cannot find the game folder next to this file. & pause & exit /b)
echo Serving %CD%
start "" http://localhost:8000/game/
py -m http.server 8000
pause
