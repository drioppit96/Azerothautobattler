@echo off
rem Makes the dungeon_walls folder: every dungeon floor as a picture to draw the walls on (never overwrites your drawings).
cd /d "%~dp0"
py make_wall_kit.py
if exist "..\dungeon_walls" start "" "..\dungeon_walls"
pause
