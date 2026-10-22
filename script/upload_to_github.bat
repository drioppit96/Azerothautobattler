@echo off
rem Uploads the "wow excel" folder to your GitHub repository.
rem Put this file in C:\wow excel\script and double-click it.
cd /d "%~dp0.."
echo Folder: %CD%
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo Git is not installed. Install Git-2.46.2-64-bit.exe first ^(the last version for Windows 7^):
  echo https://github.com/git-for-windows/git/releases/tag/v2.46.2.windows.1
  pause
  exit /b
)
if not exist ".gitignore" (
  echo .gitignore is missing - unzip github_upload.zip into C:\wow excel first.
  pause
  exit /b
)
echo.
echo Checking for files over 95 MB ^(GitHub refuses files over 100 MB^) ...
set BIG=0
if not exist ".git" git init -q
rem only the files that would be uploaded (new or changed, not ignored) - git's own storage in .git is not checked
for /f "delims=" %%F in ('git ls-files -o -m --exclude-standard') do if %%~zF GEQ 95000000 (echo   %%F  %%~zF bytes & set BIG=1)
if "%BIG%"=="1" (
  echo.
  echo The files above are too big. Add them to .gitignore ^(open it with Notepad^) or move them out, then run this again.
  pause
  exit /b
)
echo   none - good.
echo.
set REPO=https://github.com/drioppit96/Azerothautobattler.git
echo Repository: %REPO%
set /p REPO2=Press Enter to upload there (or paste another address): 
if not "%REPO2%"=="" set REPO=%REPO2%
git config user.name "auto-battler"
git config user.email "auto-battler@localhost"
git config core.autocrlf false
git config http.postBuffer 524288000
echo.
echo Adding files ^(this can take a few minutes^) ...
git add -A
git commit -q -m "Upload game files and data"
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin %REPO%
echo.
echo Uploading. If a GitHub sign-in window opens, sign in. If it asks for a password in this window,
echo paste a personal access token instead ^(GitHub: Settings - Developer settings - Personal access tokens^).
git push -u origin main
echo.
if errorlevel 1 (echo Upload FAILED - send a screenshot of this window.) else (echo Done. Tell Claude the repository name.)
pause
