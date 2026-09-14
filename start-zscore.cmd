@echo off
rem ===============================================================
rem  Z-Score Supplier Risk - Launcher  -- Command Prompt / cmd version
rem
rem  Usage: double-click this file, or run  start-zscore.cmd
rem
rem  WHY IS THIS FILE ENGLISH-ONLY?  -- do not "fix" it, read on
rem  ---------------------------------------------------------------
rem  cmd.exe mis-parses batch files that contain NON-ASCII bytes.
rem  It loses character sync in the middle of a line, splits the line
rem  there, and then tries to execute the leftover fragment as a
rem  command. The user sees a wall of:
rem      'xxxx' is not recognized as an internal or external command
rem  Calling  chcp 65001  does NOT fix this -- it only makes the
rem  surviving text *display* correctly, the parser stays broken.
rem  Pure ASCII is the only encoding that is safe on EVERY Windows
rem  codepage, so every message in this file is plain English.
rem  The Chinese step-by-step guide is in the project's docs folder.
rem
rem  ALSO REQUIRED:
rem    - CRLF line endings  -- LF alone breaks goto / call label lookup
rem    - NO UTF-8 BOM       -- a BOM makes cmd try to run the BOM bytes
rem    - no parentheses and no "!" inside echo text
rem    - parentheses are used ONLY as if / for block delimiters here, so a
rem      stray one can never close a block early
rem    - "!" is eaten by delayed expansion, so only !VAR! forms are used
rem  Verify with:  python3 scripts/check-cmd-batch.py
rem ===============================================================

setlocal enabledelayedexpansion

set "PORT=3000"
set "URL=http://localhost:%PORT%"
set "WAIT_SECONDS=150"

rem %~dp0 is this file's folder and always ends with a backslash
set "REPO_DIR=%~dp0"
set "REPO_DIR=%REPO_DIR:~0,-1%"
set "WEB_DIR=!REPO_DIR!\zscore-web"
set "NEXT_ENTRY=!WEB_DIR!\node_modules\next\dist\bin\next"

echo.
echo ==============================================
echo   Z-Score Supplier Risk - Launcher
echo   Command Prompt version, no PowerShell needed
echo ==============================================
echo.

if not exist "!WEB_DIR!" (
    echo [ERROR] Cannot find the web folder:
    echo         !WEB_DIR!
    echo         Please keep this file in the project root, that is the
    echo         folder which also contains "zscore-web".
    goto :fail
)

rem ---- 1. is the port already listening? ----
call :port_open
if "!PORT_OPEN!"=="1" (
    echo [INFO] The service is already running, nothing to start.
    echo.
    echo        Open this address in your browser:  !URL!
    echo.
    start "" "!URL!"
    goto :done
)

rem ---- 2. is Node.js available? ----
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this computer.
    echo.
    echo         Please install Node.js 18 or newer. LTS 20 recommended.
    echo             https://nodejs.org/
    echo.
    echo         After installing, close this window, open a NEW Command
    echo         Prompt, and run this file again.
    goto :fail
)

rem ---- 3. are the web dependencies installed? ----
if not exist "!NEXT_ENTRY!" (
    echo [INFO] Web dependencies are missing, running npm install now.
    echo        The first run takes about 1 to 3 minutes, please wait.
    echo.
    pushd "!WEB_DIR!"
    call npm install
    if errorlevel 1 (
        echo.
        echo [INFO] Direct download failed, retrying with a China mirror...
        call npm config set registry https://registry.npmmirror.com
        call npm install
    )
    popd
    if not exist "!NEXT_ENTRY!" (
        echo.
        echo [ERROR] npm install failed. Please check your network.
        echo         Manual retry:
        echo             cd /d "!WEB_DIR!"
        echo             npm config set registry https://registry.npmmirror.com
        echo             npm install
        goto :fail
    )
    echo.
)

rem ---- 4. remove a leftover lock file ----
rem If Next.js was killed instead of shut down, .next\dev\lock stays
rem behind and the next start silently moves to port 3001.
if exist "!WEB_DIR!\.next\dev\lock" (
    echo [INFO] Removing a leftover lock file from the previous run...
    del /f /q "!WEB_DIR!\.next\dev\lock" >nul 2>&1
)

rem ---- 5. start the dev server in the background ----
rem A separate minimised window is opened on purpose: the service keeps
rem running after this window closes, the user can watch the live log
rem there, and closing that window is the safest way to stop the app.
echo [INFO] Starting the dev server in the background...
pushd "!WEB_DIR!"
start "zscore-dev" /min cmd /c "npm run dev -- -p %PORT%"
popd

rem ---- 6. wait until the port is listening ----
echo [INFO] Waiting for the server, up to %WAIT_SECONDS% seconds.
echo        The first compile can be slow on an old hard disk.
set /a TRIES=0

:waitloop
set /a TRIES+=1
timeout /t 1 /nobreak >nul 2>&1
call :port_open
if "!PORT_OPEN!"=="1" goto :ready
if !TRIES! geq %WAIT_SECONDS% goto :waittimeout
<nul set /p "=."
goto :waitloop

:waittimeout
echo.
echo.
echo [ERROR] The server was not ready within %WAIT_SECONDS% seconds.
echo         Click the taskbar window titled "zscore-dev" and read the
echo         error printed inside it.
goto :fail

:ready
echo.
echo.
echo ==============================================
echo   SUCCESS - the service is running
echo ==============================================
echo.
echo   Open this address in your browser:  !URL!
echo.
echo   Live log   : the taskbar window titled "zscore-dev"
echo   To stop it : close that "zscore-dev" window
echo.
start "" "!URL!"
goto :done

rem ---------------------------------------------------------------
rem  Is the port LISTENING? The answer goes into PORT_OPEN.
rem  Deliberately NOT using "for /f" over a pipe: under some console
rem  codepages the old cmd loses piped output early and the loop body
rem  never runs. findstr's exit code is reliable instead:
rem  errorlevel 0 = a match was found, 1 = no match.
rem ---------------------------------------------------------------
:port_open
set "PORT_OPEN=0"
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 set "PORT_OPEN=1"
goto :eof

:fail
echo.
echo The script has stopped.
echo Please screenshot the messages above and send them to whoever
echo set this up for you. The Chinese guide is in the docs folder
echo of this project.
echo.
pause
exit /b 1

:done
echo Press any key to close this window.
echo The service keeps running in the background, so closing this
echo window does NOT stop the app.
pause >nul
exit /b 0
