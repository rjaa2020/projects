@echo off
setlocal

set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

set API_PORT=8010
set WEB_PORT=3010
set API_URL=http://127.0.0.1:%API_PORT%

set PYTHON_EXE=%ROOT_DIR%.venv\Scripts\python.exe
if not exist "%PYTHON_EXE%" set PYTHON_EXE=%ROOT_DIR%..\.venv\Scripts\python.exe
if not exist "%PYTHON_EXE%" set PYTHON_EXE=python

powershell -ExecutionPolicy Bypass -File "%ROOT_DIR%scripts\restart-woodshed.ps1" -ApiPort %API_PORT% -WebPort %WEB_PORT%

call npm run web:install
if errorlevel 1 (
  echo Failed to install web dependencies.
  pause
  exit /b 1
)

start "Woodshed API" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%ROOT_DIR%'; & '%PYTHON_EXE%' -m uvicorn woodshed.api:app --host 127.0.0.1 --port %API_PORT%"
start "Woodshed Web" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%ROOT_DIR%'; $env:WOODSHED_API_URL='%API_URL%'; $env:PORT='%WEB_PORT%'; npm run web"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:%WEB_PORT%"

exit /b 0
