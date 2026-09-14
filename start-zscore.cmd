@echo off
chcp 65001 >nul
rem ^ 切到 UTF-8 代码页。本文件是 UTF-8 编码，不切码页的话中文提示会变乱码。

rem ===============================================================
rem  Z-Score 供应商信用评估系统 —— 启动脚本（命令提示符 / cmd 版）
rem
rem  用法：双击本文件；或在命令提示符里执行  start-zscore.cmd
rem
rem  与 start-zscore.ps1 功能等价，但**完全不依赖 PowerShell**。
rem  适用于：习惯用命令提示符，或公司策略禁用了 PowerShell 的电脑。
rem
rem  本文件约定（改动时务必保持）：
rem    - 编码 UTF-8，且**不加 BOM**（加了 BOM，cmd 会把 @echo off 当命令执行）
rem    - 行尾必须是 CRLF（纯 LF 会让 goto / call 找不到标签）
rem  校验命令：python3 scripts/check-cmd-batch.py
rem ===============================================================

setlocal enabledelayedexpansion

set "PORT=3000"
set "URL=http://localhost:%PORT%"

rem %~dp0 = 本文件所在目录（末尾自带反斜杠），即仓库根
set "REPO_DIR=%~dp0"
if "!REPO_DIR:~-1!"=="\" set "REPO_DIR=!REPO_DIR:~0,-1!"
set "WEB_DIR=!REPO_DIR!\zscore-web"
set "NEXT_ENTRY=!WEB_DIR!\node_modules\next\dist\bin\next"

echo.
echo ==============================================
echo   Z-Score 供应商信用评估系统 - 启动器
echo   （命令提示符版 · 不依赖 PowerShell）
echo ==============================================
echo.

if not exist "!WEB_DIR!" (
    echo [错误] 找不到前端目录：
    echo        !WEB_DIR!
    echo        请确认本文件位于项目根目录内（和 zscore-web 同一层）。
    goto :fail
)

rem ── 1. 端口是否已在监听 ──
call :port_open
if "!PORT_OPEN!"=="1" (
    echo [提示] 服务已经在运行，无需重复启动。
    echo.
    echo   请打开浏览器访问： !URL!
    echo.
    start "" "!URL!"
    goto :done
)

rem ── 2. Node.js 是否可用 ──
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js。
    echo.
    echo        请先安装 Node.js 18 以上版本（推荐 20 LTS）：
    echo            https://nodejs.org/zh-cn
    echo        安装后请关闭并重新打开命令提示符，再运行本脚本。
    goto :fail
)

rem ── 3. 前端依赖是否已安装 ──
if not exist "!NEXT_ENTRY!" (
    echo [提示] 尚未安装前端依赖，正在自动执行 npm install ...
    echo        首次大约需要 1-3 分钟，请耐心等待。
    echo.
    pushd "!WEB_DIR!"
    call npm install
    if errorlevel 1 (
        echo.
        echo [提示] 直连安装失败，改用国内镜像重试...
        call npm config set registry https://registry.npmmirror.com
        call npm install
    )
    popd
    if not exist "!NEXT_ENTRY!" (
        echo.
        echo [错误] 前端依赖安装失败，请检查网络后重试。
        echo        手动重试步骤：
        echo          cd /d "!WEB_DIR!"
        echo          npm config set registry https://registry.npmmirror.com
        echo          npm install
        goto :fail
    )
    echo.
)

rem ── 4. 清理上次异常退出残留的锁文件 ──
rem Next.js 开发模式被强制关闭时会残留 .next\dev\lock，导致下次自动改用 3001 等端口
if exist "!WEB_DIR!\.next\dev\lock" (
    echo [清理] 移除上次残留的锁文件...
    del /f /q "!WEB_DIR!\.next\dev\lock" >nul 2>&1
)

rem ── 5. 后台启动 ──
rem 起一个独立的最小化窗口：既脱离本窗口常驻，用户又能点任务栏看实时日志
echo [启动] 正在后台启动开发服务器...
pushd "!WEB_DIR!"
start "zscore-dev" /min cmd /c "npm run dev -- -p %PORT%"
popd

rem ── 6. 等待就绪（最多 60 秒）──
echo [等待] 正在等待服务就绪（首次启动需要编译，请稍候）...
set /a TRIES=0

:waitloop
set /a TRIES+=1
timeout /t 1 /nobreak >nul 2>&1
call :port_open
if "!PORT_OPEN!"=="1" goto :ready
if !TRIES! geq 60 goto :waittimeout
<nul set /p "=."
goto :waitloop

:waittimeout
echo.
echo.
echo [超时] 60 秒内未检测到服务就绪。
echo        请点击任务栏上标题为「zscore-dev」的窗口，查看里面的报错信息。
goto :fail

:ready
echo.
echo.
echo ==============================================
echo   启动成功
echo ==============================================
echo.
echo   请在浏览器打开： !URL!
echo.
echo   查看运行日志： 点击任务栏上标题为「zscore-dev」的窗口
echo   停止服务：     关闭那个「zscore-dev」窗口即可
echo.
start "" "!URL!"
goto :done

rem ─────────────────────────────────────────────
rem  子过程：端口是否处于 LISTENING，结果写入 PORT_OPEN
rem  说明：刻意不用 for /f 去接管道输出 —— 在 chcp 65001 下，老版本 cmd 的
rem        for /f 读取管道会提前中断。findstr 的返回码更可靠：
rem        0 = 有匹配（在监听），1 = 无匹配
rem ─────────────────────────────────────────────
:port_open
set "PORT_OPEN=0"
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 set "PORT_OPEN=1"
goto :eof

:fail
echo.
echo 脚本已停止。请把上面的报错内容截图，发给帮你部署的人。
echo.
pause
exit /b 1

:done
echo 按任意键关闭本窗口（服务会继续在后台运行，不影响使用）。
pause >nul
exit /b 0
