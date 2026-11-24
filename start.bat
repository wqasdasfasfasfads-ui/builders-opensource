@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, please wait...
  call npm install
)
echo.
echo Starting the site on http://localhost:3000
echo Games dir host on http://localhost:4000
echo Close this window to stop it.
echo.
call npm start
pause
