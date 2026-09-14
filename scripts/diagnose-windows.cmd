@echo off
rem ===============================================================
rem  Z-Score Supplier Risk - Diagnostic report  -- cmd version
rem
rem  Usage: double-click this file, or run  scripts\diagnose-windows.cmd
rem
rem  WHEN TO USE IT
rem  ---------------------------------------------------------------
rem  When the launcher fails and the reason is still unclear. This file
rem  collects everything needed to diagnose a Windows problem in ONE go:
rem  OS, Node and npm versions, project layout, listening ports, the
rem  Python engine, and the complete dev server log.
rem
rem  It WRITES the same text to a report file, so the user does not have
rem  to screenshot a scrolling window: they just send that one file.
rem      diagnose-report.txt  in the project root, or, when the project
rem      folder is read only,  %TEMP%\zscore-diagnose.txt
rem
rem  It only READS. Nothing is installed, deleted or changed.
rem
rem  WHY IS THIS FILE ENGLISH-ONLY?  -- do not "fix" it
rem  ---------------------------------------------------------------
rem  cmd.exe mis-parses batch files containing NON-ASCII bytes: it loses
rem  character sync, splits the line and runs the fragment as a command,
rem  so the user sees a wall of "not recognized as an internal or external
rem  command". chcp 65001 fixes DISPLAY only, never parsing. Pure ASCII is
rem  the only safe encoding on every Windows codepage.
rem
rem  ALSO REQUIRED:
rem    - CRLF line endings, and NO UTF-8 BOM
rem    - no parentheses and no bare "!" outside of double quotes
rem    - a goto is never placed inside a for block
rem  Verify with:  python3 scripts/check-cmd-batch.py
rem ===============================================================

setlocal enabledelayedexpansion

rem This file lives in scripts\, so the project root is one level up
pushd "%~dp0.."
set "REPO_DIR=%CD%"
popd
set "WEB_DIR=!REPO_DIR!\zscore-web"
set "NEXT_ENTRY=!WEB_DIR!\node_modules\next\dist\bin\next"
set "LOG=!WEB_DIR!\dev-server.log"
set "VENV_PY=!REPO_DIR!\.venv\Scripts\python.exe"

rem Prefer a report file in the project root; fall back to %TEMP% when the
rem project folder is read only, which happens when the zip was never
rem extracted.
set "REPORT=!REPO_DIR!\diagnose-report.txt"
pushd "!REPO_DIR!"
echo x>diag-write-test.tmp 2>nul
if not exist "diag-write-test.tmp" set "REPORT=%TEMP%\zscore-diagnose.txt"
if exist "diag-write-test.tmp" del /f /q "diag-write-test.tmp" >nul 2>&1
popd

echo.
echo ============================================================
echo   Z-Score - Diagnostic report
echo ============================================================
echo.
echo Collecting information, please wait a few seconds...
echo.

call :report > "!REPORT!" 2>&1
if not exist "!REPORT!" goto :console_only

echo.
type "!REPORT!"
echo.
echo ============================================================
echo   The same text was saved to this file:
echo     !REPORT!
echo   Send that file to whoever set this project up for you.
echo ============================================================
echo.
pause
exit /b 0

:console_only
rem The report file could not be created, so print it instead.
echo NOTE: could not write a report file, printing on screen instead.
echo.
call :report
echo.
echo WARNING: this output could not be saved to a file. Please
echo          screenshot the whole window before closing it.
echo.
pause
exit /b 0

rem ===============================================================
rem  Everything below only prints. It never changes the system.
rem ===============================================================

:report
echo ============== Z-Score diagnostic report ==============
echo.
echo ---- 0. when and where ----
date /t
time /t
echo current directory: %CD%
echo report script     : %~dp0
echo.
echo ---- 1. operating system ----
ver
echo.
echo ---- 2. Node.js ----
where node 2>nul
if errorlevel 1 goto :r_no_node
echo node version:
node -v
echo npm location:
where npm 2>nul
echo npm version:
call npm -v 2>nul
goto :r_node_done
:r_no_node
echo NOT FOUND: Node.js is missing, or it is not on PATH in this window
:r_node_done
echo.
echo ---- 3. project layout ----
if exist "!WEB_DIR!" echo ok      : !WEB_DIR!
if not exist "!WEB_DIR!" echo MISSING : !WEB_DIR!
if exist "!NEXT_ENTRY!" echo ok      : node_modules\next is installed
if not exist "!NEXT_ENTRY!" echo MISSING : node_modules\next -- run scripts\setup-windows.cmd
if exist "!WEB_DIR!\.next\dev\lock" echo NOTE    : a stale .next\dev\lock is present
if not exist "!WEB_DIR!\.next\dev\lock" echo ok      : no stale .next\dev\lock
echo.
echo ---- 4. listening ports ----
echo lines below come from netstat; an empty section means nothing is listening
netstat -ano | findstr /r /c:":3000 .*LISTENING"
netstat -ano | findstr /r /c:":3001 .*LISTENING"
netstat -ano | findstr /r /c:":3002 .*LISTENING"
echo.
echo ---- 5. Python calculation engine ----
if not exist "!VENV_PY!" goto :r_no_venv
echo found: !VENV_PY!
"!VENV_PY!" -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" 2>&1
if errorlevel 1 echo FAILED: some Python modules are missing
if not errorlevel 1 echo ok: all Python modules import correctly
goto :r_venv_done
:r_no_venv
echo missing: no .venv found -- run scripts\setup-windows.cmd
echo this does not stop the web pages, but analysing a report will fail
:r_venv_done
echo.
echo ---- 6. dev server log ----
if not exist "!LOG!" goto :r_no_log
for %%A in ("!LOG!") do echo file size in bytes: %%~zA
echo ---- begin of log ----
type "!LOG!"
echo ---- end of log ----
goto :r_log_done
:r_no_log
echo no dev-server.log found, so the launcher has never started the server
:r_log_done
echo.
echo ============== end of report ==============
goto :eof
