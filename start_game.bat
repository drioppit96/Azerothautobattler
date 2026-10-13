@echo off
cd /d "%~dp0.."
start "" http://localhost:8000/game/
py -m http.server 8000
