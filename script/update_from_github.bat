@echo off
rem Downloads the newest version Claude saved on GitHub into C:\wow excel.
rem It runs from a copy in the TEMP folder, so the update can also replace this file.
if /i not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\azeroth_update.bat" >nul
  "%TEMP%\azeroth_update.bat" --run "%~dp0"
)
setlocal
cd /d "%~2.."
if not exist ".git" (echo This folder is not connected to GitHub yet - run upload_to_github first. & pause & exit /b)
rem use a plain saved token instead of the browser sign-in (which fails on Windows 7)
git config --local --replace-all credential.helper ""
git config --local --add credential.helper store
git remote set-url origin https://github.com/drioppit96/Azerothautobattler.git
echo Getting the newest version ...
git -c credential.interactive=never fetch origin main
if not errorlevel 1 goto apply
echo.
echo GitHub needs your token once (it is remembered on this PC afterwards).
echo Make one at https://github.com/settings/tokens/new - tick "repo" - and paste it here
echo with right-click, Beillesztes, then Enter.
set /p TOKEN=Token: 
if "%TOKEN%"=="" exit /b
(echo protocol=https& echo host=github.com& echo username=drioppit96& echo password=%TOKEN%& echo.) | git credential approve
git fetch origin main
if errorlevel 1 (echo. & echo Download FAILED - send a screenshot of this window. & pause & exit /b)
:apply
rem the game files become exactly the GitHub version (your own extra files, like dbc and the excel files, are not touched)
rem your dungeon wall drawings are kept: saved before the update, put back after it
if exist "%TEMP%\azeroth_walls" rmdir /s /q "%TEMP%\azeroth_walls"
if exist "dungeon_walls" xcopy "dungeon_walls" "%TEMP%\azeroth_walls\" /E /I /Y /Q >nul
git reset --hard origin/main
if errorlevel 1 (echo. & echo Update FAILED - send a screenshot of this window. & pause & exit /b)
if exist "%TEMP%\azeroth_walls" xcopy "%TEMP%\azeroth_walls" "dungeon_walls\" /E /I /Y /Q >nul
echo.
echo Up to date. Start the game with game\start_game.bat
pause
