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
rem  HOW A FAILED START IS DIAGNOSED  -- do not undo this
rem  ---------------------------------------------------------------
rem  The dev server used to run in a separate minimised window, so when
rem  startup failed this script had nothing to show and could only tell
rem  the user "go click that other window". That produced screenshots
rem  nobody could act on.
rem  Now the server output is redirected to:
rem      zscore-web\dev-server.log
rem  A sentinel line is appended the moment that process ends, so a
rem  crash is detected instead of waited out, and this script prints the
rem  log here whenever startup fails. ONE screenshot is then enough.
rem  Do not remove the redirection or the sentinel when editing.
rem
rem  ORDER OF PREFLIGHT CHECKS -- each one replaces a mystery timeout
rem  with a specific instruction the user can act on:
rem    1 web folder exists   2 service already running   3 node present
rem    4 node version OK     5 folder writable          6 dependencies
rem  Check 4 matters because Next.js 16 needs Node.js 20.9 or newer.
rem  Check 5 matters because running straight out of a zip archive leaves
rem  the folder read-only, and then nothing can compile.
rem
rem  ALSO REQUIRED:
rem    - CRLF line endings  -- LF alone breaks goto / call label lookup
rem    - NO UTF-8 BOM       -- a BOM makes cmd try to run the BOM bytes
rem    - no parentheses and no bare "!" outside of double quotes
rem    - parentheses are used ONLY as if / for block delimiters here, so
rem      a stray one can never close a block early
rem    - a goto is NEVER placed inside a "..." block; blocks only carry
rem      echo text and the branch decision is taken after the block
rem    - "!" is eaten by delayed expansion, so only !VAR! forms are used
rem  Verify with:  python3 scripts/check-cmd-batch.py
rem ===============================================================

setlocal enabledelayedexpansion

set "PORT=3000"
set "URL=http://localhost:%PORT%"
set "WAIT_SECONDS=150"
set "SENTINEL=zscore-server-exited"

rem %~dp0 is this file's folder and always ends with a backslash
set "REPO_DIR=%~dp0"
set "REPO_DIR=%REPO_DIR:~0,-1%"
set "WEB_DIR=!REPO_DIR!\zscore-web"
set "NEXT_ENTRY=!WEB_DIR!\node_modules\next\dist\bin\next"
set "LOG=!WEB_DIR!\dev-server.log"

echo.
echo ==============================================
echo   Z-Score Supplier Risk - Launcher
echo   Command Prompt version, no PowerShell needed
echo ==============================================
echo.

rem ---- 1. does the web folder exist? ----
set "FATAL="
if not exist "!WEB_DIR!" set "FATAL=1"
if defined FATAL (
    echo [ERROR] Cannot find the web folder:
    echo         !WEB_DIR!
    echo         Please keep this file in the project root, that is the
    echo         folder which also contains "zscore-web".
)
if defined FATAL goto :fail

rem ---- 2. is the service already running? ----
call :port_open %PORT%
if "!PORT_OPEN!"=="1" goto :already

rem ---- 3. is Node.js available? ----
set "FATAL="
where node >nul 2>&1
if errorlevel 1 set "FATAL=1"
if defined FATAL (
    echo [ERROR] Node.js was not found on this computer.
    echo.
    echo         Please install Node.js 20 LTS or newer:
    echo             https://nodejs.org/en/download
    echo.
    echo         After installing, close this window, open a NEW Command
    echo         Prompt, and run this file again.
)
if defined FATAL goto :fail

rem ---- 4. is Node.js new enough? ----
rem Next.js 16 requires Node.js 20.9 or newer. An older Node makes the dev
rem server print one line and exit, which the user used to see as a
rem mysterious "not ready within 150 seconds". Catch it up front instead.
rem The check below exits 0 when the version is fine, 1 when it is old.
set "FATAL="
node -e "var n=process.versions.node.split('.');process.exit(n[0]>20||(n[0]==20&&n[1]>=9)?0:1)" >nul 2>&1
if errorlevel 1 set "FATAL=1"
if defined FATAL (
    echo [ERROR] The installed Node.js is too old for this application.
    echo         Next.js 16 requires Node.js 20.9 or newer.
    echo.
    echo         The version found on this computer is:
    node -v
    echo.
    echo         Please install Node.js 20 LTS or newer, close this
    echo         window, open a NEW Command Prompt, and run this file
    echo         again:
    echo             https://nodejs.org/en/download
)
if defined FATAL goto :fail

rem ---- 5. can the project folder be written to? ----
rem Running this script from INSIDE a zip archive is a very common
rem non-technical-user mistake: the files are read-only, Next.js cannot
rem create its .next folder, and the failure looks like a mystery
rem timeout. Say exactly what to do instead.
set "FATAL="
pushd "!WEB_DIR!"
echo x>zscore-write-test.tmp 2>nul
if not exist "zscore-write-test.tmp" set "FATAL=1"
if not defined FATAL del /f /q "zscore-write-test.tmp" >nul 2>&1
popd
if defined FATAL (
    echo [ERROR] The project folder cannot be written to.
    echo         If you opened the zip file and ran this script from
    echo         inside it, close everything, right-click the zip file
    echo         and choose "Extract All", then run the script from the
    echo         extracted folder. Next.js must be able to create files.
)
if defined FATAL goto :fail

rem ---- 6. are the web dependencies installed? ----
if exist "!NEXT_ENTRY!" goto :deps_ok
echo [INFO] Web dependencies are missing, running npm install now.
echo        The first run takes about 1 to 3 minutes, please wait.
echo.
pushd "!WEB_DIR!"
call npm install
if errorlevel 1 call :npm_mirror
popd
if not exist "!NEXT_ENTRY!" goto :deps_failed
echo.
goto :deps_ok

:deps_failed
echo.
echo [ERROR] npm install failed. Please check your network.
echo         Manual retry:
echo             cd /d "!WEB_DIR!"
echo             npm config set registry https://registry.npmmirror.com
echo             npm install
goto :fail

:deps_ok

rem ---- 7. clear leftovers from a previous run ----
rem If Next.js was killed instead of shut down, .next\dev\lock stays
rem behind and the next start silently moves to port 3001. Next.js 16
rem also refuses a second instance of the same project on purpose.
if not exist "!WEB_DIR!\.next\dev\lock" goto :no_lock
echo [INFO] Removing a leftover lock file from the previous run...
del /f /q "!WEB_DIR!\.next\dev\lock" >nul 2>&1
:no_lock
rem Start from an empty log, so its content always belongs to this run.
if exist "!LOG!" del /f /q "!LOG!" >nul 2>&1

rem ---- 8. start the dev server in the background, writing a log ----
rem node is used directly on the Next.js entry file, skipping the npm
rem wrapper: one process layer less, and it does not depend on npm being
rem on PATH. The trailing "& echo ..." writes a sentinel line the moment
rem the server process ends, so a crash is detected instead of waited out.
echo [INFO] Starting the dev server...
echo        Server output is written to:
echo          !LOG!
echo.
pushd "!WEB_DIR!"
start "zscore-dev" /min cmd /c "node node_modules\next\dist\bin\next dev -p %PORT% 1>dev-server.log 2>&1 & echo %SENTINEL%>>dev-server.log"
popd

rem ---- 9. wait until the port is listening ----
echo [INFO] Waiting for the server, up to %WAIT_SECONDS% seconds.
echo        The first compile can be slow on an old hard disk.
set /a TRIES=0

:waitloop
set /a TRIES+=1
call :snooze
call :port_open %PORT%
if "!PORT_OPEN!"=="1" goto :ready
call :server_gone
if "!SERVER_GONE!"=="1" goto :serverdied
if !TRIES! geq %WAIT_SECONDS% goto :waittimeout
<nul set /p "=."
goto :waitloop

:serverdied
echo.
echo.
echo [ERROR] The dev server stopped before it was ready.
echo         Below is everything it printed. The full file is:
echo           !LOG!
echo.
echo ----------------------------------------------
call :show_log
echo ----------------------------------------------
goto :fail

:waittimeout
echo.
echo.
echo [ERROR] The server was not ready within %WAIT_SECONDS% seconds.
echo         Below is everything it printed. The full file is:
echo           !LOG!
echo.
echo ----------------------------------------------
call :show_log
echo ----------------------------------------------
echo.
echo HINT: if the log says "Port %PORT% is in use" or "trying 3001",
echo       then the server DID start, only on the next port. Open
echo       http://localhost:3001 in your browser to check.
goto :fail

:already
echo [INFO] Something is already listening on port %PORT%.
echo.
echo        Opening it in your browser now.
echo        If you do NOT see the Z-Score pages, then another program is
echo        using that port. Close it and run this file again.
echo.
start "" "!URL!"
goto :done

:ready
echo.
echo.
echo ==============================================
echo   SUCCESS - the service is running
echo ==============================================
echo.
echo   Open this address in your browser:  !URL!
echo.
echo   Server log : !LOG!
echo   To stop it : close the window titled "zscore-dev"
echo.
start "" "!URL!"
goto :done

rem ---------------------------------------------------------------
rem  Subroutines
rem ---------------------------------------------------------------

rem Retry the dependency download through a China mirror. Called only
rem when the direct npm install failed, so a working network is never
rem slowed down.
:npm_mirror
echo.
echo [INFO] Direct download failed, retrying with a China mirror...
call npm config set registry https://registry.npmmirror.com
call npm install
goto :eof

rem Is the given port LISTENING? The answer goes into PORT_OPEN.
rem Deliberately NOT using "for /f" over a pipe: under some console
rem codepages the old cmd loses piped output early and the loop body
rem never runs. findstr's exit code is reliable instead:
rem errorlevel 0 = a match was found, 1 = no match.
:port_open
set "PORT_OPEN=0"
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul 2>&1
if not errorlevel 1 set "PORT_OPEN=1"
goto :eof

rem Has the dev server already exited? Detected through the sentinel
rem line appended by the command in step 8.
:server_gone
set "SERVER_GONE=0"
if not exist "!LOG!" goto :eof
findstr /c:"%SENTINEL%" "!LOG!" >nul 2>&1
if not errorlevel 1 set "SERVER_GONE=1"
goto :eof

rem A one-second pause that NEVER fails. "timeout /t 1" aborts instantly
rem when standard input is redirected, which used to make this loop burn
rem through all 150 tries in milliseconds and report a fake timeout.
:snooze
ping -n 2 -w 800 127.0.0.1 >nul 2>&1
goto :eof

rem Print the server log, or explain why there is nothing useful to print.
:show_log
set "LOGSIZE="
if not exist "!LOG!" goto :log_missing
for %%A in ("!LOG!") do set "LOGSIZE=%%~zA"
if "!LOGSIZE!"=="0" goto :log_empty
type "!LOG!"
goto :eof

:log_missing
echo [NOTE] The log file was never created, so the dev server never
echo        started at all. Run the setup script first:
echo            scripts\setup-windows.cmd
goto :eof

:log_empty
echo [NOTE] The log file is empty. The server is running but has not
echo        printed anything yet, which usually means the very first
echo        compile is still going. Wait a minute, then open
echo        !URL! again.
goto :eof

:fail
echo.
echo The script has stopped.
echo Please screenshot the messages above and send them to whoever
echo set this up for you.
echo.
echo A more detailed report can be produced by double-clicking:
echo     scripts\diagnose-windows.cmd
echo.
echo The Chinese guide is in the docs folder of this project.
echo.
pause
exit /b 1

:done
echo Press any key to close this window.
echo The service keeps running in the background, so closing this
echo window does NOT stop the app.
pause >nul
exit /b 0
