@echo off
setlocal
cd /d %~dp0

where go >nul 2>nul
if errorlevel 1 (
    echo [build] go not found. Please install Go for Windows: https://go.dev/dl/
    exit /b 1
)

echo [build] compiling Go backend...
go build -o notes-server.exe .
if errorlevel 1 exit /b 1
echo [build] done: notes-server.exe
endlocal
