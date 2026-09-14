@echo off
chcp 65001 >nul
rem ^ 切到 UTF-8 代码页。本文件是 UTF-8 编码，不切码页的话中文会变乱码。

rem ===============================================================
rem  Z-Score 供应商信用评估系统 —— 一键环境准备脚本（命令提示符 / cmd 版）
rem
rem  用法（在本文件所在目录的上一级，也就是项目根目录）：
rem      scripts\setup-windows.cmd
rem  或直接双击本文件（脚本会自动定位项目根目录）。
rem
rem  与 scripts\setup-windows.ps1 功能等价，但**完全不依赖 PowerShell**。
rem  适用于：习惯用命令提示符，或公司策略禁用了 PowerShell 的电脑。
rem
rem  做四件事：
rem    1. 检查 Node.js / Python / Git，缺哪个就用 winget 装哪个
rem    2. 补一次 PATH（新装的软件不会自动出现在当前窗口里）
rem    3. 建 Python 环境 .venv 并装齐 requirements.txt（失败自动换清华镜像）
rem    4. 装网页依赖 npm install（失败自动换 npmmirror 镜像），并真跑一次 import 自检
rem
rem  可以重复运行：已经装好的会自动跳过。
rem
rem  本文件约定（改动时务必保持）：
rem    - 编码 UTF-8，且**不加 BOM**（加了 BOM，cmd 会把 @echo off 当命令执行）
rem    - 行尾必须是 CRLF（纯 LF 会让 goto / call 找不到标签）
rem  校验命令：python3 scripts/check-cmd-batch.py
rem ===============================================================

setlocal enabledelayedexpansion

rem 定位项目根目录（本文件在 scripts\ 下，往上一级）
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
echo   Z-Score 供应商信用评估系统 - 环境准备
echo   （命令提示符版 · 不依赖 PowerShell）
echo ==============================================
echo.
echo   项目目录： !REPO_DIR!
echo.

if not exist "!WEB_DIR!" (
    echo [错误] 这不像项目根目录，找不到子目录 zscore-web。
    echo        请确认本文件位于项目根的 scripts 文件夹内。
    goto :done
)

rem ── 0. 先把常见安装位置补进本次会话的 PATH ──
rem winget 装完会更新注册表，但**当前窗口仍拿着旧的 PATH**，
rem 于是出现「明明装完了还提示找不到命令」。这里按默认安装位置兜底。
call :prepend_known_paths

rem ── 1. 检查并按需安装 Node.js / Python / Git ──
echo [1/4] 检查运行环境...
call :ensure node   "Node.js" "OpenJS.NodeJS.LTS"
call :ensure python "Python"  "Python.Python.3.12"
call :ensure git    "Git"     "Git.Git"

rem 刚装上的东西可能落在新目录，再补一次 PATH
call :prepend_known_paths

if defined JUST_INSTALLED (
    echo.
    echo ==============================================
    echo   已为你装好缺少的组件
    echo ==============================================
    echo.
    echo   新装的软件不会自动出现在**当前这个窗口**里。
    echo   请照做：
    echo      1. 关闭本窗口
    echo      2. 重新运行一次本脚本（双击即可）
    echo.
    echo   第二次运行会自动跳过已经装好的部分，直接继续装依赖。
    echo.
    goto :done
)

rem ── 2. Python 环境 ──
echo.
echo [2/4] 准备 Python 计算引擎环境...

if not defined python_PATH set "python_PATH=python"

if exist "!VENV_PY!" (
    echo       [已装] 虚拟环境 .venv
) else (
    echo       [创建] 虚拟环境 .venv ...
    "!python_PATH!" -m venv "!REPO_DIR!\.venv"
    if not exist "!VENV_PY!" (
        echo       [失败] 虚拟环境创建失败。请确认 Python 安装完整（含 pip 与 venv）。
        set "SETUP_INCOMPLETE=1"
        goto :after_py
    )
)

rem 自检：依赖齐全就跳过安装
"!VENV_PY!" -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" >nul 2>&1
if not errorlevel 1 (
    echo       [已装] Python 依赖齐全
    goto :after_py
)

echo       [安装] 正在安装 requirements.txt（首次约 2-3 分钟）...
"!VENV_PY!" -m pip install -r "!REPO_DIR!\requirements.txt"
if errorlevel 1 (
    echo       [提示] 直连 PyPI 失败，改用清华镜像重试...
    "!VENV_PY!" -m pip install --timeout 120 -i https://pypi.tuna.tsinghua.edu.cn/simple -r "!REPO_DIR!\requirements.txt"
)

rem 再自检一次
"!VENV_PY!" -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" >nul 2>&1
if errorlevel 1 (
    echo       [失败] Python 依赖仍不完整。上传财报时会提示引擎启动失败。
    echo              手动重试： "!VENV_PY!" -m pip install --timeout 120 -r "!REPO_DIR!\requirements.txt"
    set "SETUP_INCOMPLETE=1"
) else (
    echo       [自检] 依赖齐全
)

:after_py

rem ── 3. 网页依赖 ──
echo.
echo [3/4] 准备网页环境（npm install）...

if exist "!NEXT_ENTRY!" (
    echo       [已装] 前端依赖 node_modules
    goto :after_npm
)

pushd "!WEB_DIR!"
call npm install
if errorlevel 1 (
    echo       [提示] 直连 npm 源失败，改用 npmmirror 镜像重试...
    call npm config set registry https://registry.npmmirror.com
    call npm install
)
popd

if not exist "!NEXT_ENTRY!" (
    echo       [失败] 前端依赖安装失败。请检查网络后重试。
    echo              手动重试：
    echo                cd /d "!WEB_DIR!"
    echo                npm config set registry https://registry.npmmirror.com
    echo                npm install
    set "SETUP_INCOMPLETE=1"
) else (
    echo       [自检] 前端依赖齐全
)

:after_npm

rem ── 4. 结论 ──
echo.
echo [4/4] 检查结果
echo.

if defined SETUP_INCOMPLETE (
    echo ==============================================
    echo   环境准备未全部完成
    echo ==============================================
    echo.
    echo   上面标了 [失败] 的项目请按提示手动处理，
    echo   处理完**重新运行本脚本**即可 —— 已经装好的会自动跳过。
    echo.
) else (
    echo ==============================================
    echo   环境准备完成，可以启动系统了
    echo ==============================================
    echo.
    echo   下一步，回到项目根目录执行启动脚本：
    echo       start-zscore.cmd
    echo.
)

:done
echo.
echo 按任意键关闭本窗口...
pause >nul
exit /b 0


rem ===============================================================
rem  子过程
rem ===============================================================

rem ---------------------------------------------------------------
rem 把常见安装位置补进本次会话的 PATH（只影响本窗口，不改系统设置）
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
rem :ensure <命令> <友好名> <winget 包 ID>
rem   -- 命令可用则跳过；缺失则用 winget 安装
rem   -- 会跳过微软商店的「假 Python」存根（装在 WindowsApps 目录下）
rem   -- 找到真实路径后记录到 <命令>_PATH，例如 python_PATH
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
    echo       [已装] %~2
    goto :eof
)

echo       [缺失] %~2 —— 正在用 winget 自动安装，请稍候...

where winget >nul 2>&1
if errorlevel 1 (
    echo              [跳过] 本机没有 winget 命令，请手动安装 %~2。
    echo                     下载地址见 docs\新手安装指南-Windows.md
    set "SETUP_INCOMPLETE=1"
    goto :eof
)

winget install --id %~3 --exact --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo              [失败] %~2 自动安装未成功，请手动安装后重新运行本脚本。
    set "SETUP_INCOMPLETE=1"
    goto :eof
)

echo              [完成] %~2 已安装
set "JUST_INSTALLED=1"
goto :eof
