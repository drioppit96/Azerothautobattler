@echo off
rem Uploads the dungeon floors you drew walls on (dungeon_walls folder) to GitHub.
cd /d "%~dp0"
py send_walls.py
pause
