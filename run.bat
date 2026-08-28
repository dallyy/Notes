@echo off
setlocal
cd /d %~dp0

if not exist notes-server.exe call build.bat
if not exist notes-server.exe exit /b 1

rem Open the local page one second after the server starts.
start "" cmd /c "timeout /t 1 /nobreak >nul && start http://127.0.0.1:8000"

notes-server.exe
endlocal
