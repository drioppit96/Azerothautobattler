@echo off
rem Downloads the newest version Claude saved on GitHub into C:\wow excel.
cd /d "%~dp0.."
if not exist ".git" (echo This folder is not connected to GitHub yet - run upload_to_github first. & pause & exit /b)
rem use a plain saved token instead of the browser sign-in (which fails on Windows 7)
git config --local --replace-all credential.helper ""
git config --local --add credential.helper store
git remote set-url origin https://github.com/drioppit96/Azerothautobattler.git
echo Getting the newest version ...
git -c credential.interactive=never pull --ff-only origin main
if not errorlevel 1 goto ok
echo.
echo GitHub needs your token once (it is remembered on this PC afterwards).
echo Make one at https://github.com/settings/tokens/new - tick "repo" - and paste it here
echo with right-click, Beillesztes, then Enter.
set /p TOKEN=Token: 
if "%TOKEN%"=="" exit /b
(echo protocol=https& echo host=github.com& echo username=drioppit96& echo password=%TOKEN%& echo.) | git credential approve
git pull --ff-only origin main
if errorlevel 1 (echo. & echo Update FAILED - send a screenshot of this window. & pause & exit /b)
:ok
echo.
echo Up to date. Start the game with game\start_game.bat
pause
