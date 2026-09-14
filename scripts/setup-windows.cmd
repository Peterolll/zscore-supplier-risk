@echo off
rem ===============================================================
rem  Z-Score Supplier Risk - Environment Setup -- Command Prompt / cmd
rem
rem  Usage: double-click this file, or from the project root run
rem             scripts\setup-windows.cmd
rem
rem  Same result as scripts\setup-windows.ps1 but needs NO PowerShell.
rem  Use this one when the machine has PowerShell disabled by policy.
rem
rem  It does four things:
rem    1. checks Node.js / Python / Git, installs what is missing winget
rem    2. refreshes PATH for this window
rem    3. creates .venv and installs requirements.txt, China mirror fallback
rem    4. runs npm install, npmmirror fallback
rem  then a real python "import" self check.
rem  Safe to run again: anything already installed is skipped.
rem
rem  WHY IS THIS FILE ENGLISH-ONLY?  -- do not "fix" it, read on
rem  ---------------------------------------------------------------
rem  cmd.exe mis-parses batch files that contain NON-ASCII bytes: it
rem  loses character sync mid line, splits the line there, and tries to
rem  run the leftover fragment as a command. The user then sees a wall
rem  of  'xxxx' is not recognized as an internal or external command.
rem  chcp 65001 does NOT fix that, it only fixes display. Pure ASCII is
rem  the only encoding that is safe on every Windows codepage.
rem  Also required: CRLF line endings, NO UTF-8 BOM, and no parentheses
rem  or "!" inside echo text. Verify with scripts/check-cmd-batch.py
rem
rem  The Chinese step-by-step guide is in the project's docs folder.
rem ===============================================================

setlocal enabledelayedexpansion

rem the project root is one level above this file
pushd "%~dp0.."
set "REPO_DIR=%CD%"
popd

set "WEB_DIR=!REPO_DIR!\zscore-web"
set "VENV_PY=!REPO_DIR!\.venv\Scripts\python.exe"
set "NEXT_ENTRY=!WEB_DIR!\node_modules\next\dist\bin\next"

set "JUST_INSTALLED="
set "SETUP_INCOMPLETE="

echo.
echo ==============================================
echo   Z-Score Supplier Risk - Environment Setup
echo   Command Prompt version, no PowerShell needed
echo ==============================================
echo.
echo   Project folder: !REPO_DIR!
echo.
echo   On a machine that has nothing installed yet this takes about
echo   10 to 25 minutes and roughly 500 MB of downloads. Please wait.
echo.

if not exist "!WEB_DIR!" (
    echo [ERROR] This does not look like the project root, there is no
    echo         "zscore-web" subfolder here.
    echo         Please keep this file inside the "scripts" folder of
    echo         the project.
    goto :done
)

rem ---- 0. add well known install locations to PATH, this window only ----
rem winget updates the registry, but THIS window still holds the old
rem PATH copy. That is the number one reason for the classic
rem "I installed it but it still says command not found".
rem cmd has no reliable way to re-read the registry, so probe the
rem default install locations instead. Nothing system wide is changed.
call :prepend_known_paths

rem ---- 1. check and install Node.js / Python / Git ----
echo [1/4] Checking the run time environment...
call :ensure node   "Node.js" "OpenJS.NodeJS.LTS"
call :ensure python "Python"  "Python.Python.3.12"
call :ensure git    "Git"     "Git.Git"

rem freshly installed tools may live in new folders, refresh again
call :prepend_known_paths

if defined JUST_INSTALLED (
    echo.
    echo ==============================================
    echo   Some components were just installed
    echo ==============================================
    echo.
    echo   New software does NOT appear in an already open window.
    echo   Please do this:
    echo      1. close this window
    echo      2. run this script again, double-click is fine
    echo.
    echo   The second run skips everything already installed and
    echo   continues with the project dependencies.
    echo.
    goto :done
)

rem ---- 2. Python environment ----
echo.
echo [2/4] Preparing the Python calculation engine...

if not defined python_PATH set "python_PATH=python"

if exist "!VENV_PY!" (
    echo       [OK] virtual environment .venv already exists
) else (
    echo       [..] creating virtual environment .venv
    "!python_PATH!" -m venv "!REPO_DIR!\.venv"
    if not exist "!VENV_PY!" (
        echo       [ERROR] could not create .venv
        echo               Make sure Python is fully installed and that
        echo               the pip and venv options were included.
        set "SETUP_INCOMPLETE=1"
        goto :after_py
    )
)

rem self check: skip the install when every module is already importable
"!VENV_PY!" -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" >nul 2>&1
if not errorlevel 1 (
    echo       [OK] Python dependencies are complete
    goto :after_py
)

echo       [..] installing requirements.txt, about 2 to 3 minutes
"!VENV_PY!" -m pip install -r "!REPO_DIR!\requirements.txt"
if errorlevel 1 (
    echo       [..] direct PyPI download failed, retrying via Tsinghua mirror
    "!VENV_PY!" -m pip install --timeout 120 -i https://pypi.tuna.tsinghua.edu.cn/simple -r "!REPO_DIR!\requirements.txt"
)

"!VENV_PY!" -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" >nul 2>&1
if errorlevel 1 (
    echo       [ERROR] Python dependencies are still incomplete, so
    echo               statement analysis will fail. Manual retry:
    echo               "!VENV_PY!" -m pip install --timeout 120 -r "!REPO_DIR!\requirements.txt"
    set "SETUP_INCOMPLETE=1"
) else (
    echo       [OK] Python dependencies are complete
)

:after_py

rem ---- 3. web dependencies ----
echo.
echo [3/4] Preparing the web environment, npm install...

if exist "!NEXT_ENTRY!" (
    echo       [OK] web dependencies already installed
    goto :after_npm
)

pushd "!WEB_DIR!"
call npm install
if errorlevel 1 (
    echo       [..] direct npm download failed, retrying via npmmirror
    call npm config set registry https://registry.npmmirror.com
    call npm install
)
popd

if not exist "!NEXT_ENTRY!" (
    echo       [ERROR] npm install failed. Please check your network.
    echo               Manual retry:
    echo                 cd /d "!WEB_DIR!"
    echo                 npm config set registry https://registry.npmmirror.com
    echo                 npm install
    set "SETUP_INCOMPLETE=1"
) else (
    echo       [OK] web dependencies are complete
)

:after_npm

rem ---- 4. summary ----
echo.
echo [4/4] Result
echo.

if defined SETUP_INCOMPLETE (
    echo ==============================================
    echo   Setup did NOT fully complete
    echo ==============================================
    echo.
    echo   Fix the items marked [ERROR] above, then run this script
    echo   again. Everything already installed is skipped.
    echo.
) else (
    echo ==============================================
    echo   Environment ready, you can start the app now
    echo ==============================================
    echo.
    echo   Next step, from the project root, run:
    echo       start-zscore.cmd
    echo.
    echo   Or simply double-click start-zscore.cmd in the project root.
    echo.
)

:done
echo.
echo Press any key to close this window...
pause >nul
exit /b 0


rem ===============================================================
rem  Subroutines
rem ===============================================================

rem ---------------------------------------------------------------
rem Add well known install locations to PATH, for THIS window only.
rem No system setting is modified.
rem ---------------------------------------------------------------
:prepend_known_paths
set "EXTRA="
if exist "%ProgramFiles%\nodejs\node.exe" set "EXTRA=!EXTRA!;%ProgramFiles%\nodejs"
if exist "%ProgramFiles%\Git\cmd\git.exe" set "EXTRA=!EXTRA!;%ProgramFiles%\Git\cmd"
if exist "%LOCALAPPDATA%\Programs\Python" (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
        if exist "%%D\python.exe" set "EXTRA=!EXTRA!;%%D;%%D\Scripts"
    )
)
if defined EXTRA set "PATH=!EXTRA:~1!;%PATH%"
goto :eof


rem ---------------------------------------------------------------
rem :ensure <command> <friendly name> <winget package id>
rem   command available  -> skip
rem   otherwise          -> install with winget
rem   the Microsoft Store "fake Python" stub in WindowsApps is ignored
rem   the real path is recorded into <command>_PATH, e.g. python_PATH
rem ---------------------------------------------------------------
:ensure
set "FOUND=0"
for /f "delims=" %%P in ('where %~1 2^>nul') do (
    set "PB=%%P"
    if "!PB:WindowsApps=!"=="!PB!" (
        set "%~1_PATH=!PB!"
        set "FOUND=1"
    )
)

if "!FOUND!"=="1" (
    echo       [OK] %~2
    goto :eof
)

echo       [..] %~2 is missing, installing it with winget. Please wait.

where winget >nul 2>&1
if errorlevel 1 (
    echo            [SKIP] winget is not available on this system.
    echo                   Please install %~2 manually, see the docs folder.
    set "SETUP_INCOMPLETE=1"
    goto :eof
)

winget install --id %~3 --exact --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo            [FAIL] could not install %~2 automatically.
    echo                   Please install it manually, then run this again.
    set "SETUP_INCOMPLETE=1"
    goto :eof
)

echo            [OK] %~2 installed
set "JUST_INSTALLED=1"
goto :eof
