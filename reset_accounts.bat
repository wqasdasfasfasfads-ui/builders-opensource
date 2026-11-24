@echo off
cd /d "%~dp0"
echo This DELETES ALL accounts. Stop the server first.
pause
node reset-data.js
pause
