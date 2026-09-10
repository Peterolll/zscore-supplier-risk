# 供应商 Z-Score 自动化 · 财务风险分析平台

> **Language / 语言：** **中文** · [English](./README.en.md)
>
> 基于 **Altman Z-Score** 模型的供应商财务风险分析系统
> 财报上传 → 自动解析 → Z 值计算 → 可视化 → 字典自审 → 多供应商对比，全流程闭环

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white">
  <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white">
</p>

---

## 目录

- [这是什么](#这是什么)
- [核心能力](#核心能力)
- [下载与安装](#下载与安装)
- [快速开始](#快速开始)
- [从源码运行](#从源码运行)
- [目录结构](#目录结构)
- [文档索引](#文档索引)
- [数据与隐私](#数据与隐私)
- [技术栈](#技术栈)

---

## 这是什么

把供应商的**财报表（PDF / 扫描件 / PPTX）**丢进来，系统自动定位报表页、抽取财务科目、跑通三级抓取链与 5 道校验门，最终算出 **Altman Z-Score** 并给出风险分区（安全区 / 灰色区 / 困境区）。

面向采购、供应链风控与授信场景：**批量尽调供应商财务健康度**，并保留每一笔数字的科目级溯源证据。

支持的模型口径：

| 模型 | 适用对象 | 因子数 | 说明 |
|------|---------|--------|------|
| **Z**（1968） | 上市公司 | 5 | 含股权市场价值因子 X4 |
| **Z′**（1983） | 非上市制造业 | 5 | X4 换成账面权益 |
| **Z″**（1995） | 非上市非制造业 | 4 | 去掉周转率因子 |

---

## 核心能力

### 财务解析引擎（Python）
- **多格式 ingestion**：电子文本 PDF（pdfplumber）、扫描件 OCR（GLM-4V-Flash 视觉模型）、PPTX 财报（python-pptx）
- **多文件合并**：同一供应商多份 PDF 可一次上传，服务端自动合并再解析
- **报表自动定位**：按页面特征识别资产负债表 / 利润表所在页，不依赖固定页码假设
- **三级抓取链**：`L1 直接科目命中` → `L2 子指标求和` → `L3 会计恒等式推算`，逐级兜底
- **序号防误抓**：自动过滤 1–999 的纯整数行号，避免把「行号」当金额
- **EBIT 决策树**：`利润总额 + 利息费用` 优先；缺利息费用时退化处理
- **5 道校验门**：G1 复式平衡、G2 勾稽关系、G3 取值合理性、G4 EBIT 交叉核对、G5 完整性
- **字典自审闭环**：未识别科目写入「待审面板」，人工确认后回写生产字典，越用越准

### Web 应用（Next.js）
- **上传分析**：拖拽上传 + 行业 / 期间 / 会计准则 / 币种填写
- **可视化详情**：Z 值 SVG 仪表盘、因子分解柱状图、科目级溯源证据表、校验门状态灯
- **人工手填重算**：缺失字段可手动录入并即时重算 Z 值，推算值标注「推算待确认」
- **供应商库管理**：历史归档、按供应商聚合多期、单删 / 批量删除（级联清理）
- **多供应商对比**：勾选多个分析批次，横向对比 Z 值与因子构成
- **双语界面**：右上角下拉切换中 / 英文，偏好持久化（localStorage + cookie）

### 输出与导出
- **Excel 导出**：风险排序表 + 因子明细 Sheet（沿用现有计算器格式）
- **JSON API**：完整 `ExtractionResult` + `ZScoreResult`，供下游系统消费
- **页面复核**：字段 → 页码 → 原文 → 提取方式 / 置信度，逐条可回溯

---

## 下载与安装

### 方式一：Git 克隆（推荐，便于后续更新）

```bash
git clone https://github.com/Peterolll/zscore-supplier-risk.git
cd zscore-supplier-risk
```

后续更新只需在目录内执行：

```bash
git pull
```

### 方式二：下载 ZIP（无需安装 Git）

1. 打开仓库主页：<https://github.com/Peterolll/zscore-supplier-risk>
2. 点击右上角绿色 **`Code`** 按钮 → **`Download ZIP`**
3. 解压后进入解压目录即可

> 适用于只想快速查看代码 / 文档、或所在环境无法使用 Git 的情况。

### 只想看文档？

所有设计文档、评审报告与验证报告已归档在 **[`docs/`](./docs/README.md)** 目录，可直接在 GitHub 网页上在线阅读，无需下载代码：

| 分类 | 目录 | 内容 |
|------|------|------|
| 设计与评审 | [`docs/design/`](./docs/design) | PRD、方案设计、方案评审、财报样本分析、计算工作流图 |
| 报告与复盘 | [`docs/reports/`](./docs/reports) | 二次校验端到端验证报告、缺陷根因与修复报告 |
| 样本与素材 | [`docs/samples/`](./docs/samples) | 财报版式样本截图（脱敏） |

---

## 快速开始

### 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | 22.x | 需内置 `node:sqlite`（开发验证版本 22.22.2） |
| **Python** | 3.10+ | 运行 `zscore_pipeline` 计算引擎 |
| **Git** | 任意 | 仅「Git 克隆」方式需要 |

> 扫描件 OCR 需要额外配置 `GLM_API_KEY`（视觉模型）。**不配置不影响电子文本财报**，扫描件会返回明确的「待处理」状态而非报错。

### 一键启动（推荐）

```bash
# 首次需先完成「从源码运行」中的依赖安装
./start-zscore.sh
```

脚本会自动定位仓库根目录、后台启动开发服务器（关闭终端不中断），并在就绪后提示访问地址：

```
启动成功 → http://localhost:3000
```

---

## 从源码运行

### 1. 准备 Python 引擎环境

在**仓库根目录**执行：

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

### 2. 安装 Web 前端依赖

```bash
cd zscore-web
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
# 打开 http://localhost:3000
```

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ZSCORE_PYTHON` | 自动探测（仓库根 `.venv` → 系统 `python3`） | Python 解释器，需能 `import zscore_pipeline` |
| `ZSCORE_WORKSPACE` | `zscore-web` 的上级目录 | 引擎工作目录，需包含 `zscore_pipeline/` 包 |

通常无需手动配置。若自动探测失败，可在 `zscore-web/.env.local` 中显式指定 `ZSCORE_PYTHON`。

---

## 目录结构

```
zscore-supplier-risk/
├── README.md                  # 本文件（中文）
├── README.en.md               # English README
├── requirements.txt           # Python 引擎依赖
├── start-zscore.sh            # 一键启动脚本
├── .gitignore                 # 排除密钥 / 真实财报 / 数据库
│
├── docs/                      # 文档归档（详见 docs/README.md）
│   ├── README.md              #   文档索引
│   ├── design/                #   设计与评审文档
│   ├── reports/               #   验证 / 修复 / 审查报告
│   └── samples/               #   财报版式样本截图（脱敏）
│
├── scripts/
│   └── push-to-github.sh      # GitHub 推送辅助脚本
│
├── zscore-web/                # Next.js 16 Web 应用
│   ├── app/                   #   页面与 API 路由
│   ├── components/            #   UI 组件
│   ├── lib/                   #   引擎调用 / 数据库 / i18n / 计算
│   ├── public/                #   静态资源（含用户手册、工作流图）
│   ├── docs/                  #   AI 辅助功能 PRD
│   └── README.md / README.en.md  # 中英文用户手册
│
└── zscore_pipeline/           # Python 计算引擎
    ├── m2_extract*.py         #   文本 / PPTX 抽取
    ├── m3_locate.py           #   报表页定位
    ├── m4_map.py              #   三级映射与 EBIT 推导
    ├── m5_validate.py         #   5 道校验门
    ├── m6_calc.py             #   Z 值计算
    ├── dict/                  #   数据字典（同义词 / 指标树）
    └── benchmarks/            #   回归测试基准
```

---

## 文档索引

| 文档 | 语言 | 说明 |
|------|------|------|
| [`docs/README.md`](./docs/README.md) | 中 | **文档总索引**（从这里开始） |
| [`zscore-web/README.md`](./zscore-web/README.md) | 中 | 用户手册 v2.0：功能总览、架构、使用流程 |
| [`zscore-web/README.en.md`](./zscore-web/README.en.md) | EN | User Manual (English) |
| [`docs/design/供应商Z-Score自动化_PRD.md`](./docs/design/) | 中 | 产品需求文档 |
| [`docs/design/供应商Z-Score自动化_方案设计v2.md`](./docs/design/) | 中 | 技术方案设计 |
| [`zscore-web/docs/AI_ASSIST_PRD.md`](./zscore-web/docs/AI_ASSIST_PRD.md) | 中 | AI 辅助分析功能 PRD |

> 完整清单见 [`docs/README.md`](./docs/README.md)。

---

## 数据与隐私

本仓库**不包含**任何真实敏感数据。以下内容已被 `.gitignore` 排除，不会上传：

- 密钥与凭证：`.env`、`*.key`、`zscore_pipeline/.glm_key`、`**/ai-config.json`
- 用户数据：`zscore-web/uploads/`、`zscore_pipeline/output/`、`*.db`
- 含安全弱点的审查报告：`docs/reports/Z-Score自动化_代码审查报告.md`
- 基准配置中引用个人路径的 `profiles.json`（已提供脱敏模板）

`docs/samples/` 中的财报截图均为**脱敏版式样本**，仅用于说明版面结构，不含可识别的完整商业数据。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 16（App Router）、React 19、TypeScript 5、Tailwind CSS v4、Recharts |
| 后端 | Next.js Route Handlers、Node `node:sqlite` |
| 计算引擎 | Python 3、pdfplumber、pypdf、python-pptx、Pydantic、openpyxl |
| OCR（可选） | GLM-4V-Flash 视觉模型 |

---

<p align="center">
  <sub>供应商 Z-Score 自动化 · Altman Z-Score Supplier Risk Platform</sub>
</p>
