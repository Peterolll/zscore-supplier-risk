# Windows 新手安装指南 · 从零把系统跑起来

> 面向**完全没用过命令行**的 Windows 用户。全程复制粘贴，不需要理解原理。
> 适用系统：**Windows 10 / 11**
> 预计耗时：首次约 10–20 分钟（大部分时间在下载安装包）；以后每次启动 10 秒

> 📌 用 Mac 的用户请改看 → [`新手安装指南.md`](./新手安装指南.md)

---

## 目录

- [第 0 步：先搞懂两件事](#第-0-步先搞懂两件事)
- [名词速查](#名词速查)
- [先检查：你的电脑装齐了没有](#先检查你的电脑装齐了没有)
- [⚡ 懒人通道：一条命令从零装到能启动](#-懒人通道一条命令从零装到能启动)
- [方式一：Git 克隆（推荐）](#方式一git-克隆推荐)
- [方式二：下载 ZIP](#方式二下载-zip)
- [共同步骤：启动系统](#共同步骤启动系统)
- [以后每次怎么用 / 怎么关](#以后每次怎么用--怎么关)
- [常见问题排查](#常见问题排查)
- [一页速查卡](#一页速查卡)

---

## 第 0 步：先搞懂两件事

**第一件：两种方式只是「把文件夹拿到电脑上」的方法不同。**

```
方式一 Git 克隆  ┐
                 ├──► 都得到同一个文件夹 ──► 启动步骤完全相同
方式二 下载 ZIP  ┘
```

| | 方式一：Git 克隆 | 方式二：下载 ZIP |
|---|---|---|
| 需要装 Git 吗 | 需要（见检查步骤） | 不需要 |
| 更新到最新版 | 一条命令 `git pull` | 得重新下载一遍 |
| 适合谁 | 想长期用、想跟进更新 | 只想先看看、下完就跑 |

**第二件：命令要「在正确的文件夹里」执行。**

这是新手最容易踩的坑。PowerShell 就像一个「文件浏览器」，你让它执行命令时，它是在**你当前所在的文件夹**里干活。所以每一步我都会先让你确认「现在站在哪」。

---

## 名词速查

| 词 | 说人话 |
|---|---|
| **PowerShell** | Windows 自带的一个蓝色（或黑色）窗口，在里面打字下命令 |
| **管理员身份运行** | 右键某个图标 → 选「以管理员身份运行」，给它更高的权限 |
| **命令** | 在 PowerShell 里敲的一行字，按回车执行 |
| **`cd`** | "change directory"，切换到某个文件夹 |
| **`dir`** | 列出当前文件夹里有什么（相当于 macOS 的 `ls`） |
| **`pwd`** | 我**现在**在哪个文件夹 |
| **粘贴** | 在 PowerShell 窗口里**点右键**即可粘贴；或按 `Ctrl + V` |

**怎么打开 PowerShell？**

按 `Win` 键（或点开始菜单）→ 直接输入 `powershell` → 在搜索结果里点 **Windows PowerShell**。

> 💡 建议：找到后**右键 → 固定到任务栏**，以后一键打开。

> ⚠️ 不要用「命令提示符 / cmd」。虽然长得像，但本指南的命令是给 PowerShell 写的。

---

## 先检查：你的电脑装齐了没有

打开 PowerShell，**逐行**复制粘贴下面 4 条命令（每粘贴一条按一次回车）：

```powershell
node -v
```

```powershell
npm -v
```

```powershell
python --version
```

```powershell
git --version
```

**期望看到类似这样的输出**（版本号不用完全一样）：

```
v20.18.0
10.8.2
Python 3.12.4
git version 2.47.0.windows.2
```

### 🟥 如果四条**全部**报「无法将…识别为 cmdlet」

**这不是软件坏了，是这台电脑还没装过任何开发环境** —— 全新 Windows 的初始状态就是这样，
四条都红是**正常现象**，照着下面的清单装一遍就好。

> ⚠️ **另一种可能**：其实你已经装过了，只是**装完没有关掉 PowerShell 重开**。
> 新装的软件不会自动出现在已打开的窗口里。**先关掉窗口、重新打开 PowerShell 再试一次**，
> 如果还是四条全红，那就是真的没装。

### 📦 全新电脑的最小安装清单（3 个，按顺序装）

| # | 装什么 | 必需？ | 去哪下 | 关键动作 |
|---|---|---|---|---|
| 1 | **Node.js** | ✅ 必需 | <https://nodejs.org/zh-cn> | 选 **LTS** 版 `.msi` → 双击一路「下一步」 |
| 2 | **Python** | ✅ 必需 | 见下方[安装 Python](#安装-python重点容易装错) | ⚠️ **必须勾选 `Add python.exe to PATH`** |
| 3 | **Git** | ⭕ 可选 | <https://git-scm.com/download/win> | 只有用「方式一 Git 克隆」才需要；用「方式二 下载 ZIP」可以不装 |

**每装完一个，都要关掉并重新打开 PowerShell**，再继续装下一个。

> 💡 如果你的电脑是 Windows 10 1809 以上，也可以用一个命令装（在 PowerShell 里执行）：
>
> ```powershell
> winget install OpenJS.NodeJS.LTS ; winget install Python.Python.3.12
> ```
>
> `winget` 是 Windows 自带的软件安装器。如果提示「winget 不是内部或外部命令」，
> 说明你的系统没有它，**请老实用上表的官网下载方式**。

### 逐条对照

| 结果 | 说明 | 怎么办 |
|---|---|---|
| 四条都有版本号 | 环境齐了 | 直接跳到[方式一](#方式一git-克隆推荐)或[方式二](#方式二下载-zip) |
| `node` / `npm` 报 `无法将...识别为 cmdlet` | 没装 Node.js | 上表第 1 项 |
| `python` 报 `无法将...识别为 cmdlet` | 没装 Python | 上表第 2 项 |
| `git` 报 `无法将...识别为 cmdlet` | 没装 Git（**不影响**下载 ZIP 方式） | 上表第 3 项；只用 ZIP 方式的话可以忽略 |
| **明明装过了，还是报错** | 装完没重开 PowerShell | 关掉窗口重新打开；仍不行就重启电脑 |
| 输入 `python` 后**自动弹出微软应用商店** | 这是 Windows 的「假 Python」存根 | 见下方[安装 Python](#安装-python重点容易装错) |
| `python --version` 显示的版本低于 3.9 | 版本太老 | 建议重装 3.10 以上版本 |

### 安装 Python（重点，容易装错）

1. 打开 <https://www.python.org/downloads/windows/>，下载最新的 **Windows installer (64-bit)** `.exe`
2. 双击运行安装程序
3. ⚠️ **在第一个界面，务必勾选最下面的 `Add python.exe to PATH`** —— 这一步没勾，后面所有命令都会失败
4. 然后点 `Install Now`，等它装完
5. **关掉 PowerShell，重新打开**（必须，否则新装的 Python 不会被识别）
6. 再跑一次 `python --version` 验证

> 如果要装 Git，见下方[方式一](#方式一git-克隆推荐)里的说明。

---

## ⚡ 懒人通道：一条命令从零装到能启动

> **这台电脑什么都没装也能用这一节。** 下面的命令只用 Windows 自带功能，
> 不需要 Git、不需要 Node.js、不需要 Python —— 它会自己把这些装齐。

把下面**整段**复制，粘进 PowerShell（它会一行一行执行）：

```powershell
$ProgressPreference = 'SilentlyContinue'
$desktop = [Environment]::GetFolderPath('Desktop')
Invoke-WebRequest 'https://github.com/Peterolll/zscore-supplier-risk/archive/refs/heads/main.zip' -OutFile "$env:TEMP\zscore.zip"
Expand-Archive "$env:TEMP\zscore.zip" $desktop -Force
cd "$desktop\zscore-supplier-risk-main"
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

它依次做了：

1. 把项目下载并且解压到**桌面**
2. 进入项目文件夹
3. 运行环境准备脚本 —— 缺 Node.js / Python 就用 winget 装，然后装齐所有依赖

**中途可能出现 1–2 次授权弹窗（UAC），点「是」即可。**

最后看到 `环境准备完成，可以启动系统了` 就成功了，接着执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1
```

> ⚠️ 如果桌面已经有 `zscore-supplier-risk-main` 文件夹，`Expand-Archive -Force`
> 会**覆盖**里面的同名文件。第一次安装不用担心；想保留旧版请先改名。
>
> 想看清楚每一步在做什么、或者命令跑不通，请继续往下看**方式一 / 方式二**的手动流程。

---

## 方式一：Git 克隆（推荐）

### 第 1 步：安装 Git（若已装可跳过）

先检查：

```powershell
git --version
```

- 有版本号 → 跳到第 2 步
- 报错 → 去 <https://git-scm.com/download/win> 下载 **64-bit Git for Windows Setup**，双击一路「下一步」装完，**关掉 PowerShell 重新打开**

### 第 2 步：打开 PowerShell

见上文[名词速查](#名词速查)。

### 第 3 步：决定把项目放到哪，并「走过去」

推荐放桌面，命令如下：

```powershell
cd ~\Desktop
```

> `~\Desktop` 就是你的桌面。想放别处也行，比如 `cd ~\Documents` 是文档文件夹。

**确认到位：**

```powershell
pwd
```

应该看到形如 `C:\Users\你的用户名\Desktop` 的路径。

### 第 4 步：把项目下载下来

```powershell
git clone https://github.com/Peterolll/zscore-supplier-risk.git
```

回车后你会看到进度文字，几十秒内完成。桌面上会多出一个名为 **`zscore-supplier-risk`** 的文件夹。

> 这是公开仓库，**不需要**登录 GitHub 账号，也不会问你要密码。

### 第 5 步：进入这个文件夹

```powershell
cd zscore-supplier-risk
```

**确认到位：**

```powershell
pwd
```

应该看到 `C:\Users\你的用户名\Desktop\zscore-supplier-risk`。

✅ 方式一到此结束。接着看[共同步骤](#共同步骤启动系统)。

---

## 方式二：下载 ZIP

### 第 1 步：打开仓库网页

浏览器访问：<https://github.com/Peterolll/zscore-supplier-risk>

### 第 2 步：找到那个绿色的 `Code` 按钮

它在文件列表的**右上方**，是一个绿色按钮，写着 `Code`（旁边有个小三角）。

### 第 3 步：点 `Code` → 点 `Download ZIP`

会弹出一个小菜单，最底下是 **`Download ZIP`**，点它。

浏览器会把 `zscore-supplier-risk-main.zip` 下载到你的**下载**文件夹。

### 第 4 步：解压

打开「文件资源管理器」→ 左侧「下载」→ **右键**那个 `.zip` 文件 → 选 **`全部解压缩...`** → 点「解压」。

解压后得到文件夹 **`zscore-supplier-risk-main`**（注意末尾有 `-main`）。

> ⚠️ 不要只是「双击打开」zip 就在里面操作。必须右键 →「全部解压缩」，否则文件是只读的，后面会出问题。

### 第 5 步：把它移到桌面（建议）

把 `zscore-supplier-risk-main` 文件夹**剪切/拖到**桌面，这样下一步的路径好写。

### 第 6 步：在 PowerShell 里进入这个文件夹

```powershell
cd ~\Desktop\zscore-supplier-risk-main
```

**确认到位：**

```powershell
pwd
```

应该看到 `C:\Users\你的用户名\Desktop\zscore-supplier-risk-main`。

> ⚠️ **注意文件夹名字不一样**：ZIP 解压出来是 `zscore-supplier-risk-main`（带 `-main`），Git 克隆出来是 `zscore-supplier-risk`（不带）。别搞混，否则 `cd` 会报「找不到路径」。

✅ 方式二到此结束。接着看下面的共同步骤。

---

## 共同步骤：启动系统

> 下面的**第 1 步只需要做一次**（第一次装依赖）。以后启动见[下一节](#以后每次怎么用--怎么关)。
>
> 前提：你已经在项目文件夹里（`pwd` 显示的路径末尾是 `zscore-supplier-risk` 或 `zscore-supplier-risk-main`）。

### 第 1 步：装依赖（一条命令 · 推荐）

只要 Node.js 和 Python 已经装好（见[先检查](#先检查你的电脑装齐了没有)），
**这一条命令就能把剩下的全部装完**：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

它会依次完成：

| 顺序 | 做什么 |
|---|---|
| 1 | 检查 Node.js / Python / Git，缺哪个就用 winget 装哪个 |
| 2 | 新建 Python 环境 `.venv` 并安装 `requirements.txt`（直连失败自动换清华镜像重试） |
| 3 | 安装网页依赖 `npm install`（失败自动换 npmmirror 镜像重试） |
| 4 | 真跑一次 `import` 自检，确认计算引擎可用 |

**看到这一行就算成功：**

```
环境准备完成，可以启动系统了
```

> ✅ **可以直接跳到[第 3 步：启动](#第-3-步回到项目根目录并启动)。**
>
> 如果它提示「以下项目未完成」，说明有东西没装上 —— 按列出的项对照
> [常见问题排查](#常见问题排查)处理，**处理完重新运行本脚本即可**，
> 它只会补做没完成的部分，已经装好的会自动跳过。

<details>
<summary>👉 脚本用不了 / 想手动一步步来？（点开看手动步骤）</summary>

> 下面两步就是脚本内部做的事。手动做一遍完全可以，只是要自己盯报错。

### 第 1 步：装 Python 环境（约 2–3 分钟）

```powershell
python -m venv .venv
```

> 这条命令在项目里创建一个「独立的 Python 小房间」，不会污染你电脑上其他的 Python。跑完没有提示就是成功了。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> 这条会下载并安装解析财报需要的 Python 库。屏幕上会滚动很多行文字，**这是正常的**，等它停下来、回到可以输入的状态就好了。

> 💡 **如果报错 `Could not find a version that satisfies the requirement pypdfium2 ... (from versions: none)`**
> 这**不是**包不存在，几乎总是**网络超时**（pip 默认只等 15 秒）。先切国内镜像、再放宽超时重跑：
>
> ```powershell
> .\.venv\Scripts\python.exe -m pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
> ```
>
> ```powershell
> .\.venv\Scripts\python.exe -m pip install --timeout 120 -r requirements.txt
> ```

**装完做一次自检**（强烈建议，能提前发现问题）：

```powershell
.\.venv\Scripts\python.exe -c "import pdfplumber, pypdfium2, pypdf, pptx, pydantic, openpyxl; print('依赖齐全')"
```

看到 `依赖齐全` 就说明这一步成功了。

- 如果报 `ModuleNotFoundError` → 把上面那条 `pip install` 再跑一遍
- 如果 `pip` 下载很慢或超时 → 先切国内镜像再重跑：

  ```powershell
  .\.venv\Scripts\python.exe -m pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
  ```

> ⚠️ **这一步不要跳过。** 仓库里不放 `.venv` 文件夹（体积大且和操作系统绑定），
> 所以每台电脑都要自己装一次。跳过的话，上传财报时会提示**引擎启动失败**。

### 第 2 步：装网页环境（约 1–3 分钟）

```powershell
cd zscore-web
```

```powershell
npm install
```

> 会滚动大量内容，中间可能出现黄色的 `warning` 字样 —— **可以忽略**。
> 成功的标志是最后出现类似 `added 400 packages in 30s` 的提示。

若下载很慢，可先切国内镜像：

```powershell
npm config set registry https://registry.npmmirror.com
```

然后重新执行 `npm install`。

</details>

### 第 3 步：回到项目根目录并启动

```powershell
cd ..
```

```powershell
powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1
```

> **为什么命令这么长？** Windows 默认禁止运行 `.ps1` 脚本（安全策略）。加
> `-ExecutionPolicy Bypass` 表示「这一次允许运行」，**不会**改动你电脑的任何系统设置，关掉窗口就失效。

**成功的标志**，屏幕上出现：

```
启动成功

  请在浏览器打开： http://localhost:3000
```

脚本还会**自动帮你打开浏览器**。

> 首次启动需要编译网页，可能要等 20–60 秒，这是正常的。

### 第 4 步：开始用

1. 首页点击**上传财报并分析**
2. 选择供应商的财报文件（PDF / 扫描件 / PPTX 都行）
3. 填写供应商名称、行业、期间、会计准则、币种
4. 点分析 → 等几秒 → 看到 Z 值仪表盘和风险分区

### 第 5 步（可选，只有需要扫描件 OCR 时）：配置 AI 密钥

- **电子版 PDF**（能用鼠标选中文字的那种）：开箱即用，**不需要**任何额外配置
- **扫描件 / 图片版 PDF**（整页像照片一样，选不中文字）：需要配置视觉模型的密钥
  1. 浏览器打开 <http://localhost:3000/settings>
  2. 填入服务商地址、模型名与 API Key，点「测试」确认连通
  3. 保存后再回到首页上传扫描件即可

---

## 以后每次怎么用 / 怎么关

### 启动（只需两步）

```powershell
cd ~\Desktop\zscore-supplier-risk
```

```powershell
powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1
```

> 如果你用的是方式二，第二行对应的文件夹名是 `zscore-supplier-risk-main`。

然后浏览器打开 <http://localhost:3000>（脚本通常已自动打开）。

### 更新到最新版（仅方式一支持）

```powershell
cd ~\Desktop\zscore-supplier-risk
```

```powershell
git pull
```

拉完更新后，**重跑一次环境准备脚本**即可（它会自动跳过已经装好的部分，只补新的）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

### 关闭服务

系统是**后台运行**的，关掉 PowerShell 窗口它也会继续跑（这样你才能一直用）。想彻底关掉：

```powershell
Stop-Process -Name node -Force
```

> 不想关也没关系，重启电脑会自动停。

### 如果提示「服务已在运行」

说明之前启动的还在跑，直接打开浏览器访问 <http://localhost:3000> 即可，不用重复启动。

---

## 常见问题排查

| 现象 | 原因 | 怎么办 |
|---|---|---|
| **不知道从哪下手 / 依赖总是装不干净** | —— | 先放手让脚本试一次：`powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1`。它会装全依赖并真跑一次自检，缺什么会直接列出来 |
| `setup-windows.ps1` 报「系统没有 winget」 | 系统缺 winget（旧版 Windows） | 不影响，按提示手动下载安装缺失的组件，然后**重新运行本脚本** |
| 输入 `python` **弹出微软应用商店** | 装的是 Windows 的「假 Python」存根 | 去 <https://www.python.org/downloads/windows/> 装真 Python，安装时**勾选 Add python.exe to PATH** |
| `python -m venv .venv` 报 `No module named venv` | Python 安装不完整 | 重装 Python，安装选项里确保勾选 `pip` 与 `venv` |
| `cd : 找不到路径` | 文件夹名写错 / 不在那个位置 | 先 `dir` 看看当前有什么；确认方式一是不带 `-main`、方式二带 `-main` |
| `git : 无法将...识别为 cmdlet` | Git 没装 | 去 <https://git-scm.com/download/win> 下载安装，装完**重开 PowerShell** |
| `npm : 无法将...识别为 cmdlet` | Node 没装 | 去 <https://nodejs.org/zh-cn> 装 LTS 版 `.msi`，装完**重开 PowerShell** |
| `无法加载文件 ...start-zscore.ps1，因为在此系统上禁止运行脚本` | Windows 默认的脚本执行策略 | 用完整命令 `powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1`；或在当前窗口先执行 `Set-ExecutionPolicy -Scope Process Bypass` 再运行 |
| `ModuleNotFoundError: No module named 'pdfplumber'` | Python 依赖没装成功 | 回到项目根目录，重跑 `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` |
| 上传财报后提示**引擎启动失败 / SPAWN_ERROR** | Python 环境不完整 | 跑[第 1 步的自检命令](#第-1-步装-python-环境约-23-分钟)；确认 `pip install` 是在**项目根目录**执行的 |
| 只有一个 PDF 能分析，多个 PDF 一起传就报错 | 缺 `pypdf`（多文件合并用） | 重跑 `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` |
| 启动时提示 `端口 3000 已被占用` | 上次的服务还在跑 | 直接访问 <http://localhost:3000>；或先 `Stop-Process -Name node -Force` 再重启 |
| `npm install` 卡住不动 | 网络访问 npm 官方源太慢 | `npm config set registry https://registry.npmmirror.com` 后重试 |
| `pip install` 卡住不动 | 网络访问 PyPI 太慢 | 见[第 1 步](#第-1-步装-python-环境约-23-分钟)里的清华镜像配置 |
| `Could not find a version that satisfies the requirement ... (from versions: none)` | **不是包缺失**，是 pip 索引请求超时 | 切清华镜像并加长超时：`.\.venv\Scripts\python.exe -m pip install --timeout 120 -r requirements.txt` |
| 页面上传扫描件后提示「待处理」 | 扫描件需要 OCR 密钥 | 见[第 5 步](#第-5-步可选只有需要扫描件-ocr-时配置-ai-密钥)；电子版 PDF 不受影响 |
| 想中途取消正在跑的命令 | —— | 按 `Ctrl + C` |
| 路径里有空格导致命令报错 | 例如用户名是 `Zhang San` | 把整个路径用英文双引号包起来：`cd "C:\Users\Zhang San\Desktop\zscore-supplier-risk"` |

---

## 一页速查卡

```powershell
# ── 前置：先装 Node.js 和 Python（只做一次）──
winget install OpenJS.NodeJS.LTS ; winget install Python.Python.3.12
# 之后关掉并重新打开 PowerShell

# ── 拿到项目 ──
cd ~\Desktop
git clone https://github.com/Peterolll/zscore-supplier-risk.git   # 没装 Git 就用「下载 ZIP」方式
cd zscore-supplier-risk

# ── 一键装完全部依赖（只做一次，可重复运行）──
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1

# ── 每次启动 ──
powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1
# 浏览器打开 http://localhost:3000

# ── 关闭 ──
Stop-Process -Name node -Force
```

---

## 与 macOS 版本的命令对照

| 用途 | macOS | Windows (PowerShell) |
|---|---|---|
| 打开命令行 | 终端 / Terminal | Windows PowerShell |
| 列出当前文件夹内容 | `ls` | `dir` |
| 建 Python 虚拟环境 | `python3 -m venv .venv` | `python -m venv .venv` |
| 调用 venv 里的 Python | `./.venv/bin/python` | `.\.venv\Scripts\python.exe` |
| 装 Python 依赖 | `./.venv/bin/pip install -r requirements.txt` | `.\.venv\Scripts\python.exe -m pip install -r requirements.txt` |
| 一键装全部依赖 | （手动两步） | `powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1` |
| 启动系统 | `bash start-zscore.sh` | `powershell -ExecutionPolicy Bypass -File .\start-zscore.ps1` |
| 关闭服务 | `lsof -ti :3000 \| xargs kill` | `Stop-Process -Name node -Force` |

---

<p align="center">
  <sub>遇到问题卡住了？把 PowerShell 里报错的那几行文字截图，发给帮你部署的人即可。</sub>
</p>
