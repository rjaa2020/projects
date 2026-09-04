@echo off
setlocal EnableExtensions

set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

set API_PORT=8010
set WEB_PORT=3010
set API_URL=http://127.0.0.1:%API_PORT%
set HEALTH_URL=%API_URL%/health
set VENV_DIR=%ROOT_DIR%.venv
set VENV_PY=%VENV_DIR%\Scripts\python.exe
set NEED_NODE=0
set CHANGELOG_FILE=%ROOT_DIR%CHANGELOG.md
set VERSION_STATE_FILE=%ROOT_DIR%.woodshed_last_launched_version
set WEB_DEPS_HASH_FILE=%ROOT_DIR%.woodshed_web_deps.sha256
set CURRENT_VERSION=
set LAST_LAUNCHED_VERSION=
set SHOULD_LAUNCH=1
set FORCE_LAUNCH=0

if /I "%~1"=="--force" set FORCE_LAUNCH=1
if /I "%~1"=="/force" set FORCE_LAUNCH=1

if "%FORCE_LAUNCH%"=="1" (
  echo --force detected: bypassing version/changelog gate checks.

  call :resolve_pyproject_version
  if errorlevel 1 (
    set "CURRENT_VERSION="
  )
) else (
  call :resolve_pyproject_version
  if errorlevel 1 (
    pause
    exit /b 1
  )

  call :validate_changelog_version
  if errorlevel 1 (
    pause
    exit /b 1
  )

  call :check_new_version_gate
  if errorlevel 1 (
    pause
    exit /b 1
  )

  if "%SHOULD_LAUNCH%"=="0" (
    echo No new released version is available.
    echo Current project version: %CURRENT_VERSION%
    if defined LAST_LAUNCHED_VERSION echo Last launched release: %LAST_LAUNCHED_VERSION%
    echo Bump version in pyproject.toml and CHANGELOG.md to run this launcher again.
    echo Or run with --force to bypass this gate for local testing.
    pause
    exit /b 0
  )
)

call :detect_bootstrap_python
if errorlevel 1 (
  pause
  exit /b 1
)

call :ensure_venv
if errorlevel 1 (
  pause
  exit /b 1
)

call :ensure_python_dependencies
if errorlevel 1 (
  pause
  exit /b 1
)

call :ensure_node
if errorlevel 1 (
  pause
  exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%ROOT_DIR%scripts\restart-woodshed.ps1" -ApiPort %API_PORT% -WebPort %WEB_PORT%
if errorlevel 1 (
  echo Failed to reset prior Woodshed processes.
  pause
  exit /b 1
)

call :ensure_web_dependencies
if errorlevel 1 (
  pause
  exit /b 1
)

start "Woodshed API" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%ROOT_DIR%'; & '%VENV_PY%' -m uvicorn woodshed.api:app --host 127.0.0.1 --port %API_PORT%"
echo Started Woodshed API window. Waiting for health check at %HEALTH_URL% ...

call :wait_for_api
if errorlevel 1 (
  echo Woodshed API did not become healthy at %HEALTH_URL%.
  echo Check the 'Woodshed API' window for Python errors, then re-run this launcher.
  pause
  exit /b 1
)

start "Woodshed Web" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%ROOT_DIR%'; $env:WOODSHED_API_URL='%API_URL%'; $env:PORT='%WEB_PORT%'; npm run web"
echo Started Woodshed Web window on http://127.0.0.1:%WEB_PORT%

if defined CURRENT_VERSION (
  call :mark_launched_version
  if errorlevel 1 (
    echo Warning: could not persist launched version marker: %VERSION_STATE_FILE%
  )
)

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:%WEB_PORT%"
echo Launch complete.

exit /b 0

:detect_bootstrap_python
set "BOOTSTRAP_PY="

if exist "%VENV_PY%" set "BOOTSTRAP_PY=%VENV_PY%"
if not defined BOOTSTRAP_PY if exist "%ROOT_DIR%..\.venv\Scripts\python.exe" set "BOOTSTRAP_PY=%ROOT_DIR%..\.venv\Scripts\python.exe"
if not defined BOOTSTRAP_PY (
  where py >nul 2>&1
  if not errorlevel 1 set "BOOTSTRAP_PY=py -3"
)
if not defined BOOTSTRAP_PY (
  where python >nul 2>&1
  if not errorlevel 1 set "BOOTSTRAP_PY=python"
)

if not defined BOOTSTRAP_PY (
  call :detect_installed_python_exe
)

if not defined BOOTSTRAP_PY (
  echo Python 3.10+ not found. Attempting auto-install via winget/choco/scoop...
  call :install_python_windows
  if errorlevel 1 exit /b 1

  call :detect_installed_python_exe
  where py >nul 2>&1
  if not errorlevel 1 set "BOOTSTRAP_PY=py -3"
  if not defined BOOTSTRAP_PY (
    where python >nul 2>&1
    if not errorlevel 1 set "BOOTSTRAP_PY=python"
  )
)

if not defined BOOTSTRAP_PY (
  echo Python still not found after attempted install.
  echo Install Python manually from https://www.python.org/downloads/
  exit /b 1
)

call %BOOTSTRAP_PY% --version >nul 2>&1
if errorlevel 1 (
  echo Python command exists but is not runnable: %BOOTSTRAP_PY%
  call :detect_installed_python_exe
  if defined BOOTSTRAP_PY (
    call %BOOTSTRAP_PY% --version >nul 2>&1
    if not errorlevel 1 exit /b 0
  )

  echo Attempting auto-install via winget/choco/scoop...

  set "BOOTSTRAP_PY="
  call :install_python_windows
  if errorlevel 1 (
    echo Could not recover from non-runnable Python command.
    echo If this is a Windows Store alias, disable it in App execution aliases.
    exit /b 1
  )

  call :detect_installed_python_exe
  where py >nul 2>&1
  if not errorlevel 1 set "BOOTSTRAP_PY=py -3"
  if not defined BOOTSTRAP_PY (
    where python >nul 2>&1
    if not errorlevel 1 set "BOOTSTRAP_PY=python"
  )

  if not defined BOOTSTRAP_PY (
    echo Python still not found after attempted install.
    echo Install Python manually from https://www.python.org/downloads/
    exit /b 1
  )

  call %BOOTSTRAP_PY% --version >nul 2>&1
  if errorlevel 1 (
    echo Python remains non-runnable after attempted install: %BOOTSTRAP_PY%
    echo Disable Windows Store Python aliases in App execution aliases, then rerun.
    exit /b 1
  )
)

exit /b 0

:detect_installed_python_exe
for %%P in (
  "%LocalAppData%\Programs\Python\Python313\python.exe"
  "%LocalAppData%\Programs\Python\Python312\python.exe"
  "%LocalAppData%\Programs\Python\Python311\python.exe"
  "%LocalAppData%\Programs\Python\Python310\python.exe"
  "%ProgramFiles%\Python313\python.exe"
  "%ProgramFiles%\Python312\python.exe"
  "%ProgramFiles%\Python311\python.exe"
  "%ProgramFiles%\Python310\python.exe"
  "%ProgramFiles(x86)%\Python313\python.exe"
  "%ProgramFiles(x86)%\Python312\python.exe"
  "%ProgramFiles(x86)%\Python311\python.exe"
  "%ProgramFiles(x86)%\Python310\python.exe"
) do (
  if exist "%%~P" (
    set "BOOTSTRAP_PY=%%~P"
    exit /b 0
  )
)
exit /b 1

:ensure_venv
if exist "%VENV_PY%" exit /b 0

echo Creating local virtual environment at %VENV_DIR% ...
call %BOOTSTRAP_PY% -m venv "%VENV_DIR%"
if errorlevel 1 (
  echo Failed to create virtual environment.
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo Virtual environment was created, but Python executable is missing: %VENV_PY%
  exit /b 1
)

exit /b 0

:ensure_python_dependencies
if "%FORCE_LAUNCH%"=="1" (
  echo --force: reinstalling local Woodshed package only...
  "%VENV_PY%" -m pip install --upgrade pip
  if errorlevel 1 (
    echo Failed to upgrade pip.
    exit /b 1
  )

  "%VENV_PY%" -m pip install --force-reinstall --no-deps -e "."
  if errorlevel 1 (
    echo Failed to force-reinstall local Woodshed package.
    exit /b 1
  )

  "%VENV_PY%" -c "import fastapi, uvicorn" >nul 2>&1
  if errorlevel 1 (
    echo Missing required web dependencies. Installing missing packages...
    "%VENV_PY%" -m pip install fastapi uvicorn
    if errorlevel 1 (
      echo Failed to install required web dependencies.
      exit /b 1
    )
  )

  exit /b 0
)

"%VENV_PY%" -c "import woodshed, fastapi, uvicorn" >nul 2>&1
if not errorlevel 1 (
  echo Python package installation found. Skipping pip install.
  exit /b 0
)

echo Python package missing/incomplete. Installing...
"%VENV_PY%" -m pip install --upgrade pip
if errorlevel 1 (
  echo Failed to upgrade pip.
  exit /b 1
)

"%VENV_PY%" -m pip install --no-deps -e "."
if errorlevel 1 (
  echo Failed to install local Woodshed package.
  exit /b 1
)

"%VENV_PY%" -c "import fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
  echo Missing required web dependencies. Installing missing packages...
  "%VENV_PY%" -m pip install fastapi uvicorn
  if errorlevel 1 (
    echo Failed to install required web dependencies.
    exit /b 1
  )
)

"%VENV_PY%" -c "import woodshed, fastapi, uvicorn" >nul 2>&1
if errorlevel 1 (
  echo Python package check failed after install.
  exit /b 1
)

exit /b 0

:ensure_web_dependencies
set "WEB_DEPS_SOURCE=%ROOT_DIR%web\package-lock.json"
if not exist "%WEB_DEPS_SOURCE%" set "WEB_DEPS_SOURCE=%ROOT_DIR%web\package.json"

if not exist "%WEB_DEPS_SOURCE%" (
  echo Missing web dependency manifest file.
  exit /b 1
)

set "CURRENT_WEB_HASH="
call :get_file_hash "%WEB_DEPS_SOURCE%" CURRENT_WEB_HASH
if errorlevel 1 (
  echo Failed to hash %WEB_DEPS_SOURCE% for dependency cache check.
  exit /b 1
)

set "STORED_WEB_HASH="
if exist "%WEB_DEPS_HASH_FILE%" set /p STORED_WEB_HASH=<"%WEB_DEPS_HASH_FILE%"

if /I "%CURRENT_WEB_HASH%"=="%STORED_WEB_HASH%" if exist "%ROOT_DIR%web\node_modules" (
  echo Web dependencies unchanged. Skipping npm install.
  exit /b 0
)

echo Web dependencies changed. Installing/refreshing...
call npm run web:install
if errorlevel 1 (
  echo Failed to install web dependencies.
  exit /b 1
)

>"%WEB_DEPS_HASH_FILE%" echo %CURRENT_WEB_HASH%
if errorlevel 1 (
  echo Warning: could not write web dependency hash marker.
)

exit /b 0

:ensure_node
set NEED_NODE=0
where node >nul 2>&1
if errorlevel 1 set NEED_NODE=1

where npm >nul 2>&1
if errorlevel 1 set NEED_NODE=1

if "%NEED_NODE%"=="1" (
  echo Node.js/npm not found. Attempting auto-install via winget/choco/scoop...
  call :install_node_windows
  if errorlevel 1 exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo node still not found after attempted install.
  echo Install Node.js LTS from https://nodejs.org/
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm still not found after attempted install.
  echo Install Node.js LTS from https://nodejs.org/
  exit /b 1
)

exit /b 0

:install_python_windows
where winget >nul 2>&1
if not errorlevel 1 (
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if not errorlevel 1 exit /b 0
)

where choco >nul 2>&1
if not errorlevel 1 (
  choco install python -y
  if not errorlevel 1 exit /b 0
)

where scoop >nul 2>&1
if not errorlevel 1 (
  scoop install python
  if not errorlevel 1 exit /b 0
)

echo Could not auto-install Python with winget/choco/scoop.
exit /b 1

:install_node_windows
where winget >nul 2>&1
if not errorlevel 1 (
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if not errorlevel 1 exit /b 0
)

where choco >nul 2>&1
if not errorlevel 1 (
  choco install nodejs-lts -y
  if not errorlevel 1 exit /b 0
)

where scoop >nul 2>&1
if not errorlevel 1 (
  scoop install nodejs-lts
  if not errorlevel 1 exit /b 0
)

echo Could not auto-install Node.js with winget/choco/scoop.
exit /b 1

:wait_for_api
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='%HEALTH_URL%'; $healthy=$false; 1..24 | ForEach-Object { try { $resp = Invoke-RestMethod -Uri $url -TimeoutSec 2; if ($resp.status -eq 'ok') { $healthy=$true; break } } catch {} Start-Sleep -Milliseconds 500 }; if (-not $healthy) { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:resolve_pyproject_version
set "CURRENT_VERSION="
if not exist "%ROOT_DIR%pyproject.toml" (
  echo Missing pyproject.toml: %ROOT_DIR%pyproject.toml
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in (`findstr /r /c:"^[ ]*version[ ]*=" "%ROOT_DIR%pyproject.toml"`) do (
  set "CURRENT_VERSION=%%B"
  goto :resolve_pyproject_version_found
)

:resolve_pyproject_version_found
set "CURRENT_VERSION=%CURRENT_VERSION:"=%"
set "CURRENT_VERSION=%CURRENT_VERSION: =%"

if not defined CURRENT_VERSION (
  echo Could not determine [project].version from pyproject.toml
  exit /b 1
)

exit /b 0

:validate_changelog_version
if not exist "%CHANGELOG_FILE%" (
  echo Missing changelog file: %CHANGELOG_FILE%
  exit /b 1
)

findstr /r /c:"^## \[%CURRENT_VERSION%\]" "%CHANGELOG_FILE%" >nul
if errorlevel 1 (
  echo CHANGELOG.md does not contain a release heading for version %CURRENT_VERSION%
  echo Add a heading like: ## [%CURRENT_VERSION%] - YYYY-MM-DD
  exit /b 1
)

exit /b 0

:check_new_version_gate
set "LAST_LAUNCHED_VERSION="
if exist "%VERSION_STATE_FILE%" (
  set /p LAST_LAUNCHED_VERSION=<"%VERSION_STATE_FILE%"
)

if not defined LAST_LAUNCHED_VERSION (
  set "SHOULD_LAUNCH=1"
  exit /b 0
)

set "IS_NEWER=false"
call :is_version_newer "%CURRENT_VERSION%" "%LAST_LAUNCHED_VERSION%"
if errorlevel 2 (
  echo Could not compare versions. Ensure versions are semantic x.y.z values.
  exit /b 1
)

if errorlevel 1 (
  set "SHOULD_LAUNCH=1"
) else (
  set "SHOULD_LAUNCH=0"
)

exit /b 0

:mark_launched_version
if not defined CURRENT_VERSION exit /b 1
>"%VERSION_STATE_FILE%" echo %CURRENT_VERSION%
if errorlevel 1 exit /b 1
exit /b 0

:get_file_hash
setlocal
set "HASH_TARGET=%~1"
set "HASH_VALUE="

if not exist "%HASH_TARGET%" endlocal & exit /b 1

for /f "usebackq delims=" %%H in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%HASH_TARGET%').Hash"`) do (
  set "HASH_VALUE=%%H"
)

if not defined HASH_VALUE endlocal & exit /b 1
endlocal & set "%~2=%HASH_VALUE%" & exit /b 0

:is_version_newer
setlocal
set "V1=%~1"
set "V2=%~2"

for /f "tokens=1-3 delims=." %%a in ("%V1%") do (
  set "A1=%%a"
  set "B1=%%b"
  set "C1=%%c"
)
for /f "tokens=1-3 delims=." %%a in ("%V2%") do (
  set "A2=%%a"
  set "B2=%%b"
  set "C2=%%c"
)

if not defined A1 endlocal & exit /b 2
if not defined B1 endlocal & exit /b 2
if not defined C1 endlocal & exit /b 2
if not defined A2 endlocal & exit /b 2
if not defined B2 endlocal & exit /b 2
if not defined C2 endlocal & exit /b 2

echo %A1%| findstr /r "^[0-9][0-9]*$" >nul || (endlocal & exit /b 2)
echo %B1%| findstr /r "^[0-9][0-9]*$" >nul || (endlocal & exit /b 2)
echo %C1%| findstr /r "^[0-9][0-9]*$" >nul || (endlocal & exit /b 2)
echo %A2%| findstr /r "^[0-9][0-9]*$" >nul || (endlocal & exit /b 2)
echo %B2%| findstr /r "^[0-9][0-9]*$" >nul || (endlocal & exit /b 2)
echo %C2%| findstr /r "^[0-9][0-9]*$" >nul || (endlocal & exit /b 2)

if %A1% GTR %A2% endlocal & exit /b 1
if %A1% LSS %A2% endlocal & exit /b 0
if %B1% GTR %B2% endlocal & exit /b 1
if %B1% LSS %B2% endlocal & exit /b 0
if %C1% GTR %C2% endlocal & exit /b 1

endlocal & exit /b 0
