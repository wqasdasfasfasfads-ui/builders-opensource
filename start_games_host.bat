@echo off
cd /d "%~dp0..\windows_python_launcher"

if not exist builders_launcher.py (
  echo Cannot find builders_launcher.py next to this script.
  pause
  exit /b 1
)
if not exist games_map.json (
  echo games_map.json not found next to builders_launcher.py.
  echo Create it there first ^(see games_map1.json for an example^).
  pause
  exit /b 1
)

echo.
echo Starting the games files host on http://localhost:4000
echo It serves the folder from games_map.json's "games_dir" as plain
echo files, e.g. http://localhost:4000/test-level/test-level.exe
echo Close this window to stop it.
echo.
python builders_launcher.py --serve-files
pause
