<#
    Z-Score 供应商信用评估系统 —— Windows 一键启动脚本
    ------------------------------------------------------------------
    用法（在本文件所在目录打开 PowerShell 后执行）：
        powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1

    特点：脱离当前 PowerShell 窗口后台运行，关闭窗口也不会中断服务。
    适用：Windows 10 / 11 自带的 Windows PowerShell 5.1 及以上。
#>

# 注意：此处刻意不用 "Stop"。PowerShell 5.1 下把原生命令（python / npm）的
# stderr 输出升级为终止性错误会误伤正常的告警信息，故统一用显式判断处理错误。
$ErrorActionPreference = "Continue"

# 中文 Windows 的默认码页是 GBK，而 node / npm 输出为 UTF-8，
# 不统一成 UTF-8 的话日志里的中文（含 next 的报错）会变成乱码。
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ---------- 1. 定位目录 ----------
# $PSScriptRoot = 本脚本所在目录 = 仓库根目录；web 工程在其下的 zscore-web\
$RepoDir = $PSScriptRoot
$WebDir  = Join-Path $RepoDir "zscore-web"
$LogFile = Join-Path $env:TEMP "zscore-dev.log"
$Port    = 3000
$Url     = "http://localhost:$Port"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Z-Score 供应商信用评估系统 - 启动器" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $WebDir)) {
    Write-Host "[错误] 找不到前端目录：$WebDir" -ForegroundColor Red
    Write-Host "       请确认已完整解压/克隆项目，且本脚本位于仓库根目录。" -ForegroundColor Red
    exit 1
}

# ---------- 2. 检查端口是否已被占用 ----------
function Test-PortOpen([int]$p) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", $p)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

if (Test-PortOpen $Port) {
    Write-Host "服务已在运行，无需重复启动。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  请打开浏览器访问： $Url" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# ---------- 3. 检查 Node.js 与前端依赖 ----------
$NodeExe = $null
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if ($null -ne $nodeCmd) { $NodeExe = $nodeCmd.Source }

if ($null -eq $NodeExe) {
    Write-Host "[错误] 未检测到 Node.js。" -ForegroundColor Red
    Write-Host "       请先安装 Node.js 18 以上版本（推荐 20 LTS）：" -ForegroundColor Red
    Write-Host "       https://nodejs.org/zh-cn/download" -ForegroundColor Red
    Write-Host "       安装后请关闭并重新打开 PowerShell，再运行本脚本。" -ForegroundColor Red
    exit 1
}

$NextEntry = Join-Path $WebDir "node_modules\next\dist\bin\next"
if (-not (Test-Path $NextEntry)) {
    Write-Host "[提示] 尚未安装前端依赖（缺少 node_modules）。" -ForegroundColor Yellow
    Write-Host "       正在自动执行 npm install，首次安装约需 1-3 分钟，请耐心等待..." -ForegroundColor Yellow
    Write-Host ""
    Push-Location $WebDir
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install 失败（退出码 $LASTEXITCODE）" }
    } catch {
        Pop-Location
        Write-Host ""
        Write-Host "[错误] 依赖安装失败，请检查：" -ForegroundColor Red
        Write-Host "       1) Node.js 版本：node -v（需 18 以上）" -ForegroundColor Red
        Write-Host "       2) 网络是否可访问 npm 源；可换国内镜像后重试：" -ForegroundColor Red
        Write-Host "          npm config set registry https://registry.npmmirror.com" -ForegroundColor Red
        exit 1
    }
    Pop-Location
    Write-Host ""
}

# ---------- 4. 清理上次异常退出残留的锁文件 ----------
# Next.js 开发模式若被强制关闭，会残留 .next\dev\lock，导致下次启动自动换端口
$LockFile = Join-Path $WebDir ".next\dev\lock"
if (Test-Path $LockFile) {
    Write-Host "[清理] 发现上次残留的锁文件，正在移除：$LockFile" -ForegroundColor DarkGray
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

# ---------- 4b. 检查 Python 计算引擎环境（不影响网页启动，但分析会用到） ----------
$VenvPy = Join-Path $RepoDir ".venv\Scripts\python.exe"
if (Test-Path $VenvPy) {
    $probeOut = & $VenvPy -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[提示] Python 环境依赖不完整，上传财报会分析失败。缺失情况：" -ForegroundColor Yellow
        $probeOut | Select-Object -Last 2 | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkYellow }
        Write-Host "       修复（在本目录执行）：" -ForegroundColor Yellow
        Write-Host "         .\.venv\Scripts\python.exe -m pip install -r requirements.txt" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host "[自检] Python 计算引擎就绪（依赖齐全）。" -ForegroundColor DarkGray
    }
} else {
    Write-Host "[注意] 尚未创建 Python 虚拟环境，上传财报后无法完成分析。" -ForegroundColor Yellow
    Write-Host "       请在本目录执行以下两条命令（只需一次）：" -ForegroundColor Yellow
    Write-Host "         python -m venv .venv" -ForegroundColor White
    Write-Host "         .\.venv\Scripts\python.exe -m pip install -r requirements.txt" -ForegroundColor White
    Write-Host "       详见： docs\新手安装指南-Windows.md" -ForegroundColor Yellow
    Write-Host ""
}

# ---------- 5. 后台启动开发服务器 ----------
Write-Host "[启动] 正在后台启动开发服务器..." -ForegroundColor Gray

# 直接用 node 拉起 Next（跳过 npm / cmd 包装层，避免路径含空格时的引号问题）
$ErrFile = Join-Path $env:TEMP "zscore-dev.err.log"
foreach ($f in @($LogFile, $ErrFile)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

Start-Process -FilePath $NodeExe `
              -ArgumentList @($NextEntry, "dev", "-p", "$Port") `
              -WorkingDirectory $WebDir `
              -RedirectStandardOutput $LogFile `
              -RedirectStandardError $ErrFile `
              -WindowStyle Hidden

# ---------- 6. 等待就绪（最多 60 秒） ----------
Write-Host "[等待] 正在等待服务就绪（首次启动需要编译，请稍候）..." -ForegroundColor Gray

$ready = $false
for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-PortOpen $Port) {
        $ready = $true
        break
    }
    Write-Host "." -NoNewline -ForegroundColor DarkGray
}
Write-Host ""

if ($ready) {
    Write-Host ""
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host "  启动成功" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  请在浏览器打开： $Url" -ForegroundColor Green
    Write-Host ""
    Write-Host "  运行日志： $LogFile" -ForegroundColor DarkGray
    Write-Host "  停止服务： 在 PowerShell 执行  Stop-Process -Name node -Force" -ForegroundColor DarkGray
    Write-Host ""
    # 自动打开浏览器（若失败不影响服务）
    try { Start-Process $Url | Out-Null } catch {}
    exit 0
} else {
    Write-Host ""
    Write-Host "[超时] 60 秒内未检测到服务就绪。" -ForegroundColor Red
    Write-Host "       请查看日志排查问题：" -ForegroundColor Red
    Write-Host "         $LogFile" -ForegroundColor Red
    Write-Host "         $ErrFile" -ForegroundColor Red
    Write-Host ""
    foreach ($f in @($ErrFile, $LogFile)) {
        if ((Test-Path $f) -and ((Get-Item $f).Length -gt 0)) {
            Write-Host "---- $f 最后 20 行 ----" -ForegroundColor DarkGray
            Get-Content $f -Tail 20 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
            Write-Host ""
        }
    }
    exit 1
}
