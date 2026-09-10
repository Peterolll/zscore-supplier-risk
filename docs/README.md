# 文档索引 · Documentation Index

> **Language / 语言：** **中文** · [English](#english-version)
>
> 本目录归档供应商 Z-Score 自动化系统的全部设计文档、评审报告、验证报告与样本素材。
> This directory archives all design documents, review notes, verification reports and sample assets for the Supplier Z-Score Automation system.

返回项目主页 → [`../README.md`](../README.md) · [English](../README.en.md)

---

## 目录结构 · Directory Layout

```
docs/
├── README.md                # 本文件 · this index
├── 新手安装指南-Windows.md   # 零基础安装教程（Windows）· beginner guide for Windows
├── 新手安装指南.md           # 零基础安装教程（macOS）· beginner guide for macOS
├── design/                  # 设计与评审文档 · design & review documents
├── reports/                 # 验证 / 修复 / 审查报告 · verification, fix & review reports
└── samples/                 # 财报版式样本（脱敏）· statement layout samples (redacted)
```

---

## 零、上手教程 · Getting Started

| 文档 | 说明 |
|------|------|
| [`新手安装指南.md`](./新手安装指南.md) | **零基础安装教程**。从「怎么打开终端」开始，逐屏复制粘贴：检查环境 → 下载项目（Git 克隆 / ZIP 两种方式）→ 装依赖 → 启动 → 常见报错排查。完全没用过终端就先看这个。 |

---

## 一、设计与评审 · Design & Review

目录：[`design/`](./design)

| 文档 | 版本 / 日期 | 说明 |
|------|------------|------|
| [`供应商Z-Score自动化_PRD.md`](./design/供应商Z-Score自动化_PRD.md) | PRD v2.0 · 2026-08-19 | **产品需求文档**。定义功能边界、验收标准、Phase 1–3 交付基线 |
| [`供应商Z-Score自动化_方案设计v2.md`](./design/供应商Z-Score自动化_方案设计v2.md) | v2.2 · 2026-08-04 | **技术方案设计**。数据模型、提取链路、映射规则、验证闸门、算法选型 |
| [`供应商Z-Score自动化_方案评审.md`](./design/供应商Z-Score自动化_方案评审.md) | 2026-08-04 | **方案评审意见**。从可开发性 / 业务盲区 / 算法严谨性 / 过度设计四视角评审，P0 项已收口 |
| [`供应商Z-Score自动化_财报样本分析与方案设计.md`](./design/供应商Z-Score自动化_财报样本分析与方案设计.md) | 2026-08-04 | **样本分析**。4 份真实财报（台湾 / 大陆-香港 / 卡塔尔 ×2）的版面与准则差异拆解 |
| [`供应商Z-Score自动化_计算工作流图.html`](./design/供应商Z-Score自动化_计算工作流图.html) | 2026-08-21 | **计算工作流可视化**。端到端流程图（可在浏览器直接打开） |

> Web 应用内也提供同一张工作流图的在线版本：`/workflow` 页面。

---

## 二、报告与复盘 · Reports & Post-mortems

目录：[`reports/`](./reports)

| 文档 | 日期 | 说明 |
|------|------|------|
| [`Z-Score自动化_二次校验端到端验证报告.md`](./reports/Z-Score自动化_二次校验端到端验证报告.md) | 2026-08-27 | **二次校验层端到端验证**。在真实环境（弱视觉模型 GLM-4V-Flash）下验证「位数 / 量级二次校验层」的有效性 |
| [`测试5_税前利润识别失败_根因与修复报告.md`](./reports/测试5_税前利润识别失败_根因与修复报告.md) | 2026-09-03 | **缺陷根因与修复**。「税前利润识别不到」的完整诊断链路、两条补救路径失效原因与最终修复方案 |

> **另有一份 `Z-Score自动化_代码审查报告.md`（2026-08-29）保留在本地**，未随仓库公开 —— 该报告详列了系统当前存在的安全弱点，公开等同于向攻击者提供线索。已通过 `.gitignore` 排除。
>
> *A `Z-Score自动化_代码审查报告.md` (2026-08-29) is kept locally only and is **not published** — it enumerates the system's current security weaknesses, so publishing it would hand attackers a roadmap. It is excluded via `.gitignore`.*

---

## 三、样本与素材 · Samples & Assets

目录：[`samples/`](./samples)

| 文件 | 说明 |
|------|------|
| [`DT_202410_财报_page1.png`](./samples/DT_202410_财报_page1.png) | 财报版式样本 —— 资产负债表版面 |
| [`DT_unnamed2_p1.png`](./samples/DT_unnamed2_p1.png) | 财报版式样本 —— 第 1 页（横向三表并排版式） |
| [`DT_unnamed2_p2.png`](./samples/DT_unnamed2_p2.png) | 财报版式样本 —— 第 2 页 |

> 这些截图用于说明系统需要适配的**版面结构差异**（A4 纵向单表 vs. 横向三表并排），均为**脱敏样本**，不含可识别的完整商业数据。
>
> *These screenshots illustrate the **layout variations** the parser must handle (A4 portrait single-table vs. landscape three-tables-per-page). All are **redacted samples** with no complete identifiable business data.*

---

## 四、代码内文档 · In-Code Documentation

| 文档 | 位置 | 说明 |
|------|------|------|
| 用户手册 v2.0（中） | [`../zscore-web/README.md`](../zscore-web/README.md) | 功能总览、架构图、使用流程、API 说明 |
| User Manual (EN) | [`../zscore-web/README.en.md`](../zscore-web/README.en.md) | English user manual |
| AI 辅助功能 PRD | [`../zscore-web/docs/AI_ASSIST_PRD.md`](../zscore-web/docs/AI_ASSIST_PRD.md) | AI 识别补全功能的产品需求 |
| 用户手册（在线版） | `/manual` 页面 | Web 应用内的 HTML 手册 |
| 计算工作流（在线版） | `/workflow` 页面 | Web 应用内的交互式流程图 |

---

## 阅读顺序建议 · Suggested Reading Order

首次了解本项目，推荐按以下顺序：

1. **[`../README.md`](../README.md)** — 项目是什么、怎么装、怎么跑
2. **[`新手安装指南-Windows.md`](./新手安装指南-Windows.md)** / **[`新手安装指南.md`](./新手安装指南.md)** — 没用过命令行？按系统选一份照着做
3. **[`design/供应商Z-Score自动化_PRD.md`](./design/供应商Z-Score自动化_PRD.md)** — 功能边界与验收标准
4. **[`design/供应商Z-Score自动化_方案设计v2.md`](./design/供应商Z-Score自动化_方案设计v2.md)** — 技术实现方案
5. **[`design/供应商Z-Score自动化_计算工作流图.html`](./design/供应商Z-Score自动化_计算工作流图.html)** — 端到端流程可视化
6. **[`reports/测试5_税前利润识别失败_根因与修复报告.md`](./reports/测试5_税前利润识别失败_根因与修复报告.md)** — 真实缺陷的排查与修复范例
7. **[`../zscore-web/README.md`](../zscore-web/README.md)** — 上手使用

---

## English Version

### Documentation Index

This directory archives all design documents, review notes, verification reports and sample assets for the Supplier Z-Score Automation system.

Back to project home → [`../README.md`](../README.md) · [中文](../README.md)

```
docs/
├── README.md          # this index
├── 新手安装指南.md     # beginner install guide (Chinese)
├── design/            # design & review documents
├── reports/           # verification, fix & review reports
└── samples/           # statement layout samples (redacted)
```

#### 0. Getting Started

| Document | Language | Description |
|----------|----------|-------------|
| [`新手安装指南.md`](./新手安装指南.md) | ZH | **Beginner install guide.** Starts from "how to open Terminal", then copy-paste steps: check environment → get the project (git clone / ZIP) → install dependencies → launch → troubleshooting. Read this first if you have never used a terminal. |

#### 1. Design & Review — [`design/`](./design)

| Document | Version / Date | Description |
|----------|---------------|-------------|
| [`供应商Z-Score自动化_PRD.md`](./design/供应商Z-Score自动化_PRD.md) | PRD v2.0 · 2026-08-19 | **Product Requirements Document**. Feature scope, acceptance criteria, Phase 1–3 delivery baseline |
| [`供应商Z-Score自动化_方案设计v2.md`](./design/供应商Z-Score自动化_方案设计v2.md) | v2.2 · 2026-08-04 | **Technical solution design**. Data model, extraction chain, mapping rules, validation gates, model selection |
| [`供应商Z-Score自动化_方案评审.md`](./design/供应商Z-Score自动化_方案评审.md) | 2026-08-04 | **Design review**. Assessed across buildability, business blind spots, algorithmic rigor and over-engineering; all P0 items closed |
| [`供应商Z-Score自动化_财报样本分析与方案设计.md`](./design/供应商Z-Score自动化_财报样本分析与方案设计.md) | 2026-08-04 | **Sample analysis**. Four real statements (Taiwan / Mainland-HK / Qatar ×2), their layout and accounting-standard differences |
| [`供应商Z-Score自动化_计算工作流图.html`](./design/供应商Z-Score自动化_计算工作流图.html) | 2026-08-21 | **Workflow visualization**. End-to-end flow diagram (open directly in a browser) |

> The same workflow diagram is also available live inside the web app at `/workflow`.

#### 2. Reports & Post-mortems — [`reports/`](./reports)

| Document | Date | Description |
|----------|------|-------------|
| [`Z-Score自动化_二次校验端到端验证报告.md`](./reports/Z-Score自动化_二次校验端到端验证报告.md) | 2026-08-27 | **Second-pass validation, end-to-end**. Validates the digit / magnitude cross-check layer against a real weak vision model (GLM-4V-Flash) |
| [`测试5_税前利润识别失败_根因与修复报告.md`](./reports/测试5_税前利润识别失败_根因与修复报告.md) | 2026-09-03 | **Defect root cause & fix**. Full diagnostic trail for "profit before tax not detected", why both fallback paths failed, and the final fix |

> A `Z-Score自动化_代码审查报告.md` (2026-08-29) is kept locally and **not published** — it enumerates current security weaknesses, so publishing it would hand attackers a roadmap. It is excluded via `.gitignore`.

#### 3. Samples & Assets — [`samples/`](./samples)

| File | Description |
|------|-------------|
| [`DT_202410_财报_page1.png`](./samples/DT_202410_财报_page1.png) | Statement layout sample — balance sheet page |
| [`DT_unnamed2_p1.png`](./samples/DT_unnamed2_p1.png) | Statement layout sample — page 1 (landscape, three tables per page) |
| [`DT_unnamed2_p2.png`](./samples/DT_unnamed2_p2.png) | Statement layout sample — page 2 |

> These screenshots illustrate the **layout variations** the parser must handle (A4 portrait single-table vs. landscape three-tables-per-page). All are **redacted samples** containing no complete identifiable business data.

#### 4. In-Code Documentation

| Document | Location | Description |
|----------|----------|-------------|
| User manual v2.0 (ZH) | [`../zscore-web/README.md`](../zscore-web/README.md) | Feature overview, architecture, workflows, API |
| User manual (EN) | [`../zscore-web/README.en.md`](../zscore-web/README.en.md) | English user manual |
| AI-assist feature PRD | [`../zscore-web/docs/AI_ASSIST_PRD.md`](../zscore-web/docs/AI_ASSIST_PRD.md) | Requirements for the AI recognition & completion feature |
| User manual (online) | `/manual` page | HTML manual inside the web app |
| Workflow (online) | `/workflow` page | Interactive flow diagram inside the web app |

#### Suggested Reading Order

1. [`../README.en.md`](../README.en.md) — what it is, how to install, how to run
2. [`新手安装指南.md`](./新手安装指南.md) — new to the terminal? follow this step by step (Chinese)
3. [`design/供应商Z-Score自动化_PRD.md`](./design/供应商Z-Score自动化_PRD.md) — scope and acceptance criteria
4. [`design/供应商Z-Score自动化_方案设计v2.md`](./design/供应商Z-Score自动化_方案设计v2.md) — technical design
5. [`design/供应商Z-Score自动化_计算工作流图.html`](./design/供应商Z-Score自动化_计算工作流图.html) — end-to-end flow
6. [`reports/测试5_税前利润识别失败_根因与修复报告.md`](./reports/测试5_税前利润识别失败_根因与修复报告.md) — a real debugging case study
7. [`../zscore-web/README.en.md`](../zscore-web/README.en.md) — getting hands-on
