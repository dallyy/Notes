@echo off
setlocal
cd /d "%~dp0"

rem ── locate a C++ compiler: local portable toolchain first, then PATH ──
set "GXX="
if exist "tools\w64devkit\bin\g++.exe" set "GXX=tools\w64devkit\bin\g++.exe"
if not defined GXX if exist "tools\w64devkit\w64devkit\bin\g++.exe" set "GXX=tools\w64devkit\w64devkit\bin\g++.exe"
if not defined GXX (
  for /f "delims=" %%i in ('where g++ 2^>nul') do (
    if not defined GXX set "GXX=%%i"
  )
)
if not defined GXX (
  echo [build] No g++ found. Install MinGW-w64, or download portable w64devkit:
  echo [build]   https://github.com/skeeto/w64devkit/releases
  echo [build] and extract it into tools\  ^(tools\w64devkit\bin\g++.exe^).
  exit /b 1
)

echo [build] compiler: %GXX%
rem gcc locates as/ld via PATH — prepend the toolchain's bin directory
for %%d in ("%GXX%\..") do set "TOOLBIN=%%~fd"
set "PATH=%TOOLBIN%;%PATH%"
"%GXX%" -O2 -std=c++17 -static -pthread -I"%~dp0." server.cpp -o server.exe -lws2_32
if errorlevel 1 (
  echo [build] compile failed
  exit /b 1
)
echo [build] server.exe built successfully
