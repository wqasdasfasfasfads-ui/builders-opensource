@echo off
setlocal
set "EXE=%~1"
if "%EXE%"=="" set /p "EXE=Full path to builders.exe: "
if not exist "%EXE%" (echo File not found: %EXE% & pause & exit /b 1)
reg add "HKCU\Software\Classes\builders" /ve /d "URL:Builders Protocol" /f >nul
reg add "HKCU\Software\Classes\builders" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\builders\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
echo.
echo builders:// registered for: %EXE%
pause
