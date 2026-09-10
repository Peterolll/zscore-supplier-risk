<#
    Z-Score 供应商信用评估系统 —— Windows 环境一键准备脚本
    ==================================================================
    用法（在本文件所在目录执行）：

        powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1

    它会依次完成：
      1. 检查 Node.js / Python / Git，缺哪个就用 winget 自动装哪个
      2. 刷新当前窗口的 PATH（无需关掉重开）
      3. 创建 Python 虚拟环境并安装 requirements.txt
      4. 安装网页依赖（zscore-web 的 npm install）
      5. 真跑一次 import 自检，确认引擎可用

    可选参数：
      -SkipNode     不检查/安装 Node.js
      -SkipPython   不检查/安装 Python
      -SkipGit      不检查/安装 Git
      -NoNpm        跳过 npm install（只准备 Python 环境）

    跑完后启动系统：
        powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipNode,
    [switch]$SkipPython,
    [switch]$SkipGit,
    [switch]$NoNpm
)

# 不设 "Stop"：原生程序（winget / python / npm）写 stderr 属正常告警，
# 在 PowerShell 5.1 下会被升级成终止性错误，误伤流程。统一用退出码判断。
$ErrorActionPreference = "Continue"

# 中文 Windows 的 winget/pip 输出常含 UTF-8，统一按 UTF-8 读，避免乱码
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Failures = @()

# ══════════════════════════════════════════════════════════════════
# 工具函数
# ══════════════════════════════════════════════════════════════════

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host "── $text " -ForegroundColor Cyan -NoNewline
    Write-Host ("─" * [Math]::Max(1, 58 - $text.Length)) -ForegroundColor DarkCyan
}

function Write-Ok([string]$text)   { Write-Host "   [OK]   $text" -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host "   [注意] $text" -ForegroundColor Yellow }
function Write-Info([string]$text) { Write-Host "   [信息] $text" -ForegroundColor Gray }
function Write-Err([string]$text)  { Write-Host "   [失败] $text" -ForegroundColor Red }

<#
    刷新当前会话的 PATH。
    winget 装完 Node / Python 后，注册表里的 PATH 已更新，但**当前这个 PowerShell
    窗口**拿到的还是旧副本 —— 这就是「装完了却还提示找不到命令」的原因。
    从注册表重新读一次即可，无需用户关窗口重开。
#>
function Update-SessionPath {
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $user    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $parts   = @($machine, $user) | Where-Object { $_ }
    if ($parts.Count -gt 0) { $env:Path = ($parts -join ";") }
}

<#
    查找可执行命令，并排除「微软应用商店的 Python 存根」。
    未装 Python 时，Windows 会在 WindowsApps 放一个假 python.exe，
    执行它只会弹出应用商店，因此必须识别出来当作「未安装」。
#>
function Get-RealCommand([string[]]$names) {
    foreach ($n in $names) {
        $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $c) { continue }
        if ($c.Source -and $c.Source -like "*\WindowsApps\*") { continue }
        return $c
    }
    return $null
}

function Test-Winget {
    return ($null -ne (Get-Command winget -ErrorAction SilentlyContinue))
}

<#
    用 winget 安装。返回 $true 表示「已经可用或安装成功」。
    注意：Node / Python 的官方安装包默认是「全机器安装」，会触发 UAC 授权弹窗。
#>
function Install-Package([string]$id, [string]$label, [string]$manualUrl) {
    if (-not (Test-Winget)) {
        Write-Warn "系统没有 winget，无法自动安装 $label"
        Write-Info "请手动下载安装：$manualUrl"
        return $false
    }
    Write-Info "正在安装 $label（如弹出授权窗口，请点「是」）..."
    & winget install --id $id --exact `
        --accept-package-agreements --accept-source-agreements 2>&1 |
        ForEach-Object { Write-Host "          $_" -ForegroundColor DarkGray }

    Update-SessionPath
    return ($LASTEXITCODE -eq 0)
}

# ══════════════════════════════════════════════════════════════════
# 开场
# ══════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "   Z-Score 供应商信用评估系统 - Windows 环境准备" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "项目目录：$RepoRoot"

if (-not (Test-Path (Join-Path $RepoRoot "zscore-web"))) {
    Write-Err "在 $RepoRoot 下找不到 zscore-web 目录。"
    Write-Info "请把本脚本放在项目内的 scripts\ 目录里执行。"
    exit 1
}

# ══════════════════════════════════════════════════════════════════
# 第 1 步：Node.js
# ══════════════════════════════════════════════════════════════════

$NodeExe = $null
if ($SkipNode) {
    Write-Step "第 1 步：Node.js（已跳过）"
} else {
    Write-Step "第 1 步：Node.js"
    $NodeExe = Get-RealCommand -names @("node.exe", "node")

    if ($null -ne $NodeExe) {
        $ver = (& $NodeExe.Source -v) 2>&1
        Write-Ok "已安装：node $ver"
    } else {
        Write-Warn "未检测到 Node.js，尝试用 winget 自动安装..."
        [void](Install-Package "OpenJS.NodeJS.LTS" "Node.js LTS" "https://nodejs.org/zh-cn")
        $NodeExe = Get-RealCommand -names @("node.exe", "node")
        if ($null -ne $NodeExe) {
            Write-Ok "Node.js 安装成功：$(& $NodeExe.Source -v)"
        } else {
            Write-Err "Node.js 仍未就绪，请手动安装：https://nodejs.org/zh-cn"
            $Failures += "Node.js"
        }
    }
}

# ══════════════════════════════════════════════════════════════════
# 第 2 步：Python
# ══════════════════════════════════════════════════════════════════

$PyCmd = $null
if ($SkipPython) {
    Write-Step "第 2 步：Python（已跳过）"
} else {
    Write-Step "第 2 步：Python"
    $PyCmd = Get-RealCommand -names @("python.exe", "python", "py")

    if ($null -ne $PyCmd) {
        $ver = (& $PyCmd.Source --version) 2>&1
        Write-Ok "已安装：$ver"
    } else {
        # 区分「完全没装」与「只装了应用商店存根」，给不同的提示
        $stub = Get-Command "python" -ErrorAction SilentlyContinue
        if ($null -ne $stub -and $stub.Source -like "*\WindowsApps\*") {
            Write-Warn "检测到的 python 是 Windows 应用商店的「假 Python」，不能使用。"
        } else {
            Write-Warn "未检测到 Python，尝试用 winget 自动安装..."
        }
        [void](Install-Package "Python.Python.3.12" "Python 3.12" "https://www.python.org/downloads/windows/")
        $PyCmd = Get-RealCommand -names @("python.exe", "python", "py")
        if ($null -ne $PyCmd) {
            Write-Ok "Python 安装成功：$(& $PyCmd.Source --version)"
        } else {
            Write-Err "Python 仍未就绪。请手动安装：https://www.python.org/downloads/windows/"
            Write-Warn "安装时务必勾选最下面的「Add python.exe to PATH」！"
            $Failures += "Python"
        }
    }
}

# ══════════════════════════════════════════════════════════════════
# 第 3 步：Git（可选）
# ══════════════════════════════════════════════════════════════════

if ($SkipGit) {
    Write-Step "第 3 步：Git（已跳过）"
} else {
    Write-Step "第 3 步：Git（可选，仅 git clone 方式需要）"
    $GitCmd = Get-RealCommand -names @("git.exe", "git")
    if ($null -ne $GitCmd) {
        Write-Ok "已安装：$(& $GitCmd.Source --version)"
    } else {
        Write-Warn "未检测到 Git。用「下载 ZIP」方式使用本项目时，可以不装。"
        Write-Info "如需自动安装，请手动执行：winget install --id Git.Git --exact"
    }
}

# ══════════════════════════════════════════════════════════════════
# 第 4 步：Python 虚拟环境 + 依赖
# ══════════════════════════════════════════════════════════════════

Write-Step "第 4 步：Python 计算引擎环境"

$VenvDir = Join-Path $RepoRoot ".venv"
$VenvPy  = Join-Path $VenvDir "Scripts\python.exe"
$ReqFile = Join-Path $RepoRoot "requirements.txt"

if (-not (Test-Path $VenvPy)) {
    if ($null -eq $PyCmd) {
        Write-Err "没有可用的 Python，无法创建虚拟环境。请先完成第 2 步。"
        $Failures += "虚拟环境"
    } else {
        Write-Info "正在创建虚拟环境 .venv ..."
        & $PyCmd.Source -m venv $VenvDir
        if (-not (Test-Path $VenvPy)) {
            Write-Err "虚拟环境创建失败。请确认 Python 安装完整（含 venv 与 pip 组件）。"
            $Failures += "虚拟环境"
        }
    }
} else {
    Write-Ok "虚拟环境已存在，跳过创建"
}

if (Test-Path $VenvPy) {
    Write-Info "正在安装 Python 依赖（首次约 2-5 分钟，视网速）..."
    & $VenvPy -m pip install --upgrade pip --quiet 2>&1 | Out-Null
    & $VenvPy -m pip install --retries 5 --timeout 60 -r $ReqFile 2>&1 |
        Select-Object -Last 3 | ForEach-Object { Write-Host "          $_" -ForegroundColor DarkGray }

    if ($LASTEXITCODE -ne 0) {
        # 常见失败原因是网络超时（pip 默认只等 15 秒），换国内镜像 + 放宽超时再试
        Write-Warn "直连安装失败，改用国内镜像重试..."
        & $VenvPy -m pip install --timeout 120 `
            -i https://pypi.tuna.tsinghua.edu.cn/simple -r $ReqFile 2>&1 |
            Select-Object -Last 3 | ForEach-Object { Write-Host "          $_" -ForegroundColor DarkGray }
    }

    # 真跑一次导入自检 —— 只看版本号会漏掉「版本漂亮但依赖缺失」的情况
    $probe = & $VenvPy -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Python 依赖齐全（渲染 / 解析 / 导出全部就绪）"
    } else {
        Write-Err "Python 依赖不完整："
        $probe | Select-Object -Last 2 | ForEach-Object { Write-Host "          $_" -ForegroundColor DarkYellow }
        $Failures += "Python 依赖"
    }
}

# ══════════════════════════════════════════════════════════════════
# 第 5 步：网页依赖
# ══════════════════════════════════════════════════════════════════

if ($NoNpm) {
    Write-Step "第 5 步：网页依赖（已跳过）"
} elseif ($null -eq $NodeExe) {
    Write-Step "第 5 步：网页依赖"
    Write-Err "Node.js 不可用，无法安装网页依赖。"
    $Failures += "网页依赖"
} else {
    Write-Step "第 5 步：网页依赖（npm install）"
    $WebDir   = Join-Path $RepoRoot "zscore-web"
    $NextBin  = Join-Path $WebDir "node_modules\next\dist\bin\next"

    if (Test-Path $NextBin) {
        Write-Ok "网页依赖已存在，跳过安装"
        Write-Info "如需强制重装，请手动删除 zscore-web\node_modules 后重跑本脚本"
    } else {
        Push-Location $WebDir
        Write-Info "正在安装（首次约 1-3 分钟，出现 warning 可忽略）..."
        & npm install 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "          $_" -ForegroundColor DarkGray }

        if (-not (Test-Path $NextBin)) {
            Write-Warn "直连安装失败，改用国内镜像重试..."
            & npm config set registry https://registry.npmmirror.com 2>&1 | Out-Null
            & npm install 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "          $_" -ForegroundColor DarkGray }
        }
        Pop-Location

        if (Test-Path $NextBin) {
            Write-Ok "网页依赖安装完成"
        } else {
            Write-Err "网页依赖安装失败，请检查网络后重试"
            $Failures += "网页依赖"
        }
    }
}

# ══════════════════════════════════════════════════════════════════
# 结果汇总
# ══════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
if ($Failures.Count -eq 0) {
    Write-Host "   环境准备完成，可以启动系统了" -ForegroundColor Green
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  启动命令（复制这一行）：" -ForegroundColor White
    Write-Host ""
    Write-Host "      powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1" -ForegroundColor Green
    Write-Host ""
    Write-Host "  然后浏览器打开： http://localhost:3000" -ForegroundColor Green
    Write-Host ""
    Write-Host "  详细教程： docs\新手安装指南-Windows.md" -ForegroundColor DarkGray
} else {
    Write-Host "   以下项目未完成，需要手动处理" -ForegroundColor Yellow
    Write-Host "==============================================================" -ForegroundColor Cyan
    foreach ($f in $Failures) { Write-Host "   - $f" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "  请对照教程排查： docs\新手安装指南-Windows.md" -ForegroundColor White
    Write-Host "  处理完后可重新运行本脚本。" -ForegroundColor DarkGray
}
Write-Host ""
