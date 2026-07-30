@echo off
cd /d "%~dp0"

echo Building...
cmake -B build -S .
cmake --build build --config Release

echo.
echo Running server...
build\Release\server.exe
pause
