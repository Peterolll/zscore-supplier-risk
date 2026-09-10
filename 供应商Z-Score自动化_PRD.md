# 供应商 Z-Score 自动化分析系统 — 产品需求文档（PRD）

> 文档版本：PRD v2.0
> 关联设计稿：方案设计 v2.2（`供应商Z-Score自动化_方案设计v2.md`）
> 更新日期：2026-08-19
> 状态：已实现基线（Phase 1–3 全部交付）
> 作者：供应商风险分析团队 × 自动化工程

---

## 0. 版本变更记录

| 版本 | 日期 | 变更摘要 |
|------|------|---------|
| v1.0 | 2026-08-04 | 初始版本：M1–M7 模块定义、6 基准回归、CLI + Streamlit 方案 |
| **v2.0** | **2026-08-19** | **全量更新至已实现状态**：Web 平台（Next.js）、FIELD_TREE 指标树字典 v2、三级抓取链（L1/L2/L3+DERIVED）、序号防误抓、字典自审闭环、PPTX 支持、多文件上传 + PDF 合并、人工手填 + 确认标注、供应商管理 + 级联删除、上市 / 非上市双模型、可编辑详情页 + 实时重算、Excel 导出含因子明细 |

---

## 1. 文档信息与阅读指引

| 项 | 内容 |
|----|------|
| 产品名称 | 供应商 Z-Score 自动化分析系统（内部工具，代号 Supplier-Z） |
| 目标用户 | 联想供应链 / 供应商风险分析岗 |
| 核心算法 | Altman Z-Score（原始 Z 上市 / Z′ 1983 非上市制造业 / Z″ 1995 非上市非制造业） |
| 输入 | 供应商财报 PDF / PPTX（全球各地、各会计准则、各报告期） |
| 输出 | 每个供应商的 Z-Score + 风险区 + 提取证据 + 置信度 + dict_gaps 缺口报告 |
| 本文件范围 | 需求 + 技术细节 + 已实现功能说明 |

**阅读顺序建议**：第 2–4 节理解「为什么做、给谁用」；第 5–6 节是功能 / 非功能需求（开发与验收依据）；第 7–11 节是技术契约（架构 / 数据 / 接口 / 算法 / 测试）；第 12–14 节是落地约束（路线图 / 风险 / 附录）。

---

## 2. 产品背景与问题陈述

### 2.1 业务背景

联想在做供应商风险分析时，会从全球供应商处拿到**未上市 / 上市**的财报 PDF。这些财报：
- 来自不同地区（台湾、大陆、香港、卡塔尔、欧美等）；
- 遵循不同会计准则（CAS 大陆、IFRS、HKAS、在地准则）；
- 语言混杂（繁中、简中、英文、中英双语）；
- 报告期不一（年报、半年报、季报、月报）；
- 结构千差万别（左右并排 BS、纵向标准 BS、极简 BS、合并 / 母公司双套）；
- 格式多样（PDF 电子文本、PDF 扫描件、PPTX 演示文稿）。

### 2.2 当前痛点

1. **识别耗时**：分析师需逐份打开财报、人工定位资产负债表 / 利润表、手动找科目、再抄到 Excel 算 Z-Score。单份耗时 10–30 分钟，批量时不可接受。
2. **格式不统一**：同一字段（如留存收益）在不同准则下名称 / 位置完全不同（保留盈餘 / Retained earnings / 盈余公积+未分配利润），易漏提、错提。
3. **口径陷阱**：流量字段（EBIT、营收）与存量字段（资产、负债）时间口径必须对齐。季报若不年化，Z-Score 会系统性偏低（实测差 0.48）。
4. **字典维护滞后**：每次遇到新地区 / 新准则的科目命名，需要人工修改代码中的同义词表，无法在运行时自学习。
5. **极端报表兜底不足**：极简 BS（无合计行）、序号列干扰、子指标分散等场景容易导致关键字段提取失败。

### 2.3 目标

把「收财报 → 提数据 → 算 Z-Score → 出风险结论 → 字典自学习」全流程自动化，让分析师从**逐份手工**变为**批量复核**。

---

## 3. 目标、非目标与成功指标

### 3.1 目标（Goals）

- G1：支持多地区、多准则、多语言、多报告期、多格式（PDF/PPTX）的财报自动提取。
- G2：Z-Score 计算与人工基准误差 < 1%，风险区判定 100% 一致。
- G3：对极端样本（资不抵债、零收入、负权益、极简 BS）不崩溃、给合理结果。
- G4：字典自审闭环——自动发现未识别科目，人工确认后写回字典库，持续自学习。
- G5：输出机器可消费（JSON）+ 人类可读（Excel）+ 可复核（页面）三层。
- G6：支持上市 / 非上市双模型切换，覆盖完整供应商画像。

### 3.2 非目标（Out of Scope — v2）

| 不做 | 原因 |
|------|------|
| 预测 / 预警模型（仅做静态 Z-Score 快照） | MVP 聚焦提取 + 计算正确性 |
| 多时点趋势建模 / 违约概率校准 | 先做单期，趋势仅做历史归档 |
| 自动抓取供应商公开网站 / 监管库 | 输入为人工提供的文件 |
| 替代会计准则转换（如 CAS→IFRS 重述） | 直接用原准则科目，不重述 |
| 多用户鉴权与权限隔离 | 内部工具，本地优先 |

### 3.3 成功指标（Success Metrics）

| 指标 | 目标值 | 度量方式 |
|------|--------|----------|
| 提取准确率（关键字段 TA/EQ/TL/RE/EBIT/REV） | ≥ 95% 自动命中，无需人工 | 6 基准回归 + 新样本批量 |
| Z-Score 相对人工基准误差 | < 1% | 6 基准全量 |
| 风险区判定一致率 | 100% | 6 基准 |
| 单份处理耗时（电子文本 PDF） | < 30s | 批量基准测试 |
| 批量失败率（无需人工介入） | < 10% | 10 份混合样本 |
| 极端样本存活率 | 100% 不崩溃 | 麦弗瑞基准 |
| 字典缺口发现率 | 新样本未识别科目 100% 入库 | dict_gaps 表审计 |

---

## 4. 用户、利益相关方与使用场景

### 4.1 主要用户画像

| 角色 | 诉求 | 交互方式 |
|------|------|----------|
| 供应商风险分析师（主用户） | 批量上传财报，快速拿到风险结论，只复核低置信项 | Web 上传 → 看结果页 → 编辑修正 → 导出 |
| 风险负责人（审阅者） | 看供应商风险分布、历史趋势 | 读 Excel 汇总 / Web 对比视图 |
| 字典维护者 | 维护同义词库，审核待审科目 | /dictionary 页面 → 待审面板 → 确认写回 |

### 4.2 典型使用场景（User Stories）

- **US-1**：作为分析师，我上传一个含 10 份不同格式财报的文件夹，系统跑完后给我一张风险排序表，我只需复核标黄的低置信项。
- **US-2**：作为分析师，我拿到一份香港扫描件财报，系统自动 OCR + 三级抓取链修复极简 BS，算出 Z″ 并标注「推算待确认」。
- **US-3**：作为分析师，我收到一份大陆季报，系统自动识别「季报」并对流量字段 ×4 年化，给出与年报口径可比的 Z′。
- **US-4**：作为分析师，我在分析详情页发现某字段提取有误，直接手动输入正确值，系统即时重算 Z 值。
- **US-5**：作为字典维护者，我打开 /dictionary 页面，看到系统自动收集的「待审科目」，逐条确认后将新别名写回字典库，下次遇到同类报表即可自动命中。
- **US-6**：作为分析师，我上传一份 PPTX 格式的财报演示文稿，系统自动提取并计算 Z 值。
- **US-7**：作为分析师，我同时上传同一供应商的 3 份 PDF（资产负债表 / 利润表 / 现金流量表分册），系统自动合并后统一处理。
- **US-8**：作为分析师，我需要清理过期的供应商数据，在供应商库页面批量勾选删除，系统级联清理所有关联数据。

---

## 5. 功能需求（FR）

> 优先级：P0=必须交付；P1=建议交付；P2=后续迭代。

### FR-1 财报摄入与分类（M1）
- FR-1.1 支持 Web 页面拖入 / 选择本地文件（单文件或多文件）。
- FR-1.2 支持格式：PDF（电子文本 / 扫描件）、PPTX。
- FR-1.3 多文件上传时，服务端自动合并同格式 PDF（pypdf）。
- FR-1.4 自动判断提取通道：PDF 有文本层 → pdfplumber；无文本层 → GLM-4V-Flash OCR；PPTX → python-pptx 提取。
- FR-1.5 识别语言（繁中 / 简中 / 英 / 双语）以选择同义词库分支。
- FR-1.6 识别报告期类型（年报 / 半年报 / 季报）与时间覆盖月数，供年化模块使用。
- **验收**：6 基准分别被正确路由到对应通道；PPTX 样本成功提取；多文件合并后无重复页。

### FR-2 多通道文本提取（M2）
- FR-2.1 PDF 文本通道：pdfplumber 提取 `extract_text` + `extract_tables`，保留页码与坐标。
- FR-2.2 PDF 扫描通道：GLM-4V-Flash 视觉 OCR，输出结构化文本。
- FR-2.3 PPTX 通道：python-pptx 提取幻灯片文本与表格。
- FR-2.4 输出统一为「带页码的纯文本 + 表格结构」，供下游映射消费。
- FR-2.5 OCR 未配置密钥时返回 `422 OCR_UNAVAILABLE`，不崩溃。
- **验收**：瀚荃 / 鸣志（文本通道）与麦弗瑞 / QSP（OCR 通道）均成功产出结构化文本；PPTX 端到端跑通。

### FR-3 报表定位（M3）
- FR-3.1 在文本中定位「合并资产负债表」「合并利润表」（优先合并口径）。
- FR-3.2 若存在母公司报表，一并定位但默认用合并表（CAS/IFRS 合并表含少数股东，更全）。
- FR-3.3 大陆 CAS 特殊：定位「其中：利息费用」子行而非「财务费用」母行。
- FR-3.4 多期报表（如 2025/2024 并排）取最新期（年报取 12-31；季报取报告期末）。
- **验收**：鸣志年报正确命中合并表、命中「其中：利息费用」=12,007,302.21。

### FR-4 三级科目映射与抓取链（M4）⭐ v2.0 核心升级

#### FR-4.1 字典 v2：FIELD_TREE 指标树
- 字典文件 `synonyms.json` 升级为 v2 结构，包含三部分：
  - `SYNONYMS`：字段 → 直接小计行别名列表（如 `current_assets` → `["流动资产合计", "流動資產合計", ...]`）
  - `FIELD_TREE`：字段 → `{label, components}` 结构，`components` 为子指标名 → 别名列表的映射（如 `current_assets.components.货币资金` → `["货币资金", "貨幣資金", "现金及约当现金", ...]`）
  - `EQUITY_INCL_MINORITY`：权益是否含少数股东标识
- 覆盖 6 个 BS 字段：CA / CL / TA / TL / EQ / RE，每个字段含 8–12 个子指标。
- 子指标覆盖繁简体变体（帳 / 賬、應收票據淨額、現金及約當現金 等）。

#### FR-4.2 三级抓取链
- **L1 直接命中**（置信度 1.0）：在 SYNONYMS 中直接匹配字段小计行。若命中值 < 已知子指标最大值，自动降级到 L2。
- **L2 子指标求和**（置信度 0.85 / 0.7）：通过 FIELD_TREE 的 components 逐一匹配子指标行并求和。覆盖率 ≥25% 时置信度 0.85，否则 0.7。TA/TL 的「流动部分」可使用已解析的 CA/CL 值兜底。
- **L3 会计恒等式推算**（置信度 0.7，method=DERIVED）：
  - `TL = TA − EQ`
  - `EQ = TA − TL`
  - `TA = TL + EQ`
  - `CL = TL − 非流动负债`
  - `CA = TA − 非流动资产`

#### FR-4.3 序号防误抓（sanitize）
- 当报表中存在大额数值（≥100,000）时，自动过滤 1–999 的纯整数行（防止序号列被误认为金额）。
- 防误抓在 L1/L2 之前执行，确保输入数据干净。

#### FR-4.4 提取方式标记
- 每个字段标注 `method`：`L1`（直接命中）/ `L2`（子指标求和）/ `derived`（恒等式推算）/ `manual`（人工手填）。
- 每个字段标注 `source_page` / `evidence`（原文片段）/ `confidence`（0–1）。
- `derived` 和 `manual` 方式的字段在 UI 上标记「推算待确认」/「待确认」，引导人工复核。

- **验收**：6 基准关键字段均被 L1/L2 命中（无需 L3）；新样本中 L2/L3 兜底场景验证通过；序号列不被误抓。

### FR-5 EBIT 推导（M4 子模块）
- FR-5.1 按准则 / 科目可用性的决策树推导 EBIT：
  - 优先：PBT + 利息费用（置信度 1.0）
  - 次选：PBT 单独（置信度 0.9，标记低置信）
- FR-5.2 现金流量表存在时，用「支付之利息」交叉佐证利息费用（G4 闸门）。
- **验收**：瀚荃 EBIT=497,690；鸣志年报 EBIT=58,625,743.28，且现金流量表利息支付佐证一致。

### FR-6 字典自审闭环 ⭐ v2.0 新增
- FR-6.1 在分析过程中，系统自动收集「有数值但无法匹配到任何字段 / 子指标」的科目行，生成 `dict_gaps` 记录。
- FR-6.2 每条 gap 记录包含：科目名称、数值、来源页码、样本文件名、建议目标字段、建议类型（直接 / 子指标）。
- FR-6.3 gap 记录入库后，在 `/dictionary` 页面展示「待审科目面板」。
- FR-6.4 人工操作：
  - **确认写回**：选择目标字段和类型（直接别名 / 子指标别名），系统将该别名写入 `synonyms.json` 对应位置，并标记该 gap 为「已解决」。
  - **忽略**：跳过该科目，标记为「已忽略」。
- FR-6.5 写回后下次分析遇到相同科目名即可自动命中，实现字典自学习。
- **验收**：新样本分析后 dict_gaps 入库 → /dictionary 页面可见 → 确认写回 → synonyms.json 更新 → 重跑样本可命中。

### FR-7 验证闸门（M5）
- G1 复式平衡：|TA − (TL+EQ)| < 1 元（或相对误差 < 0.01%）。
- G2 逻辑一致：CA≥CL 可负（营运资本可负），但 TA>0、TL≥0、EQ 可为负。
- G3 数值合理：关键字段量级合理（如 TA 与营收同量级级差 < 1000×），异常触发重 OCR。
- G4 EBIT 交叉：现金流量表利息支付与利润表利息费用偏差 > 20% 时标记。
- G5 完整性：8 关键字段全部非空（极简 BS 靠 L2 求和 / L3 恒等式修复）。
- **验收**：6 基准全部通过 G1–G5；麦弗瑞（无合计行）靠修复规则通过 G5。

### FR-8 Z-Score 计算（M6）
- FR-8.1 行业 → 模型选择：制造业 / 重资产 → Z′；服务业 / 轻资产 → Z″；上市 → 原始 Z。
- FR-8.2 按 §10.1 系数与阈值计算，输出 Z 值 + 风险区 + 各 X 因子。
- FR-8.3 X4 权益口径：私有企业用账面价值 = 所有者权益合计（含少数股东）；上市企业用市值。
- FR-8.4 极端值防御：TL=0 时 X4 标记 N/A 且不参与 Z，不抛异常。
- FR-8.5 前端实时重算：人工修改字段值后，前端使用 `lib/zscore.ts` 即时重算 Z 值与风险区，无需重新调用引擎。
- **验收**：6 基准 Z 值与人工基准误差 < 1%，风险区一致；手填重算结果与引擎一致。

### FR-9 供应商主数据管理（M7）
- FR-9.1 SupplierProfile：公司名、地区、准则、行业分类、上市状态、历史 Z 记录。
- FR-9.2 行业分类源：默认人工在 Profile 标注；未标注时按营收结构启发式 + 低置信标记。
- FR-9.3 历史归档：同供应商跨年 Z 记录可查趋势。
- FR-9.4 **删除管理**：
  - 单个删除：供应商详情页入口。
  - 批量删除：供应商列表页勾选后批量操作。
  - 级联清理：删除供应商时级联清理其所有分析记录、字段数据、上传文件。
- **验收**：删除操作后数据库无残留关联记录；列表页 / 详情页删除均可正常工作。

### FR-10 人工手填与确认标注 ⭐ v2.0 新增
- FR-10.1 在分析详情页，用户可对任意字段进行手动编辑（PATCH /api/runs/[runId]）。
- FR-10.2 手填字段标记 `method=manual`，UI 显示「待确认」状态。
- FR-10.3 `derived` 方式的字段标记「推算待确认」状态，引导用户核对。
- FR-10.4 前端编辑后即时调用 `lib/zscore.ts` 中的重算逻辑，更新 Z 值、风险区、因子分解、校验门状态。
- FR-10.5 修改结果保存到 `result_override` 字段，不影响原始提取结果。
- **验收**：手填字段后 Z 值即时更新；页面刷新后手填值保留。

### FR-11 多文件上传与 PDF 合并 ⭐ v2.0 新增
- FR-11.1 支持同时上传多个 PDF 文件。
- FR-11.2 服务端使用 pypdf 自动合并同格式 PDF，保留页码连续性。
- FR-11.3 合并后作为单个文件传入引擎处理。
- **验收**：瀚邦为三表合并（3 份 PDF）正确产出 Z 值 2.3582。

### FR-12 PPTX 支持 ⭐ v2.0 新增
- FR-12.1 支持 .pptx 格式财报上传。
- FR-12.2 引擎通过 `m2_extract_pptx.py` 模块提取幻灯片文本与表格。
- FR-12.3 PPTX 与 PDF 走相同的下游三级抓取链和 Z 值计算流程。
- **验收**：PPTX 财报端到端跑通，Z 值计算正确。

### FR-13 三层输出（M7）
- O1 机器 JSON：完整 ExtractionResult + ZScoreResult + dict_gaps，供下游系统消费。
- O2 人类 Excel：沿用现有计算器格式的风险排序表 + 因子明细 Sheet（Z 值 / X1–X5 / 风险区 / 提取方式）。
- O3 页面复核：Web 分析详情页，展示字段 → 页码 → 原文 → 提取方式 / 置信度，低置信项高亮。
- **验收**：三层输出内容一致；Excel 导出含因子明细 Sheet。

---

## 6. 非功能需求（NFR）

| 类别 | 需求 | 目标 |
|------|------|------|
| 准确率 | 关键字段自动命中率 | ≥ 95% |
| 性能 | 单份电子文本 PDF 端到端 | < 30s（不含人工复核） |
| 性能 | OCR 扫描件单份 | < 3min |
| 性能 | PPTX 单份 | < 30s |
| 可靠性 | 极端样本（负权益 / 零收入 / 极简 BS） | 100% 存活，不崩溃 |
| 可扩展性 | 批量规模 | 支持 ≥ 50 份 / 批 |
| 安全 / 隐私 | 财报数据 | 默认本地处理；用云 LLM 时仅发数值页、脱敏公司名（→ SUPPLIER_X） |
| 安全 / 隐私 | 凭证 / 密钥 | 不在代码 / 日志落地；云 API key 走环境变量 |
| 可观测性 | 每字段可审计 | method + source_page + evidence 全留痕 |
| 可维护性 | 同义词库 | 独立 JSON 配置文件，自审闭环写回，无需改代码 |
| 兼容性 | 输入格式 | PDF（文本层 / 扫描件）、PPTX |
| 可审计性 | 计算可追溯 | 每个 Z 值可反推至原始页码行 |
| 数据完整性 | 删除级联 | 删除供应商时无残留关联数据 |

---

## 7. 技术架构

### 7.1 模块划分与数据流

```
┌──────────────────────┐
│ Web 上传 (PDF/PPTX)  │  多文件 → pypdf 合并
└──────┬───────────────┘
       ▼
[M1 分类]──格式判断──语言/准则/报告期识别──┐
       │                                   │
       ▼                                   ▼
[M2 提取]──PDF文本(pdfplumber) / PDF扫描(GLM-4V OCR) / PPTX(python-pptx)
       │
       ▼
[M3 报表定位]──合并BS/PL 定位 + 利息费用子行 + 多期取新
       │
       ▼
[M4 三级抓取链]──sanitize(序号防误抓)
       │   ├── L1: SYNONYMS 直接命中 (conf=1.0)
       │   ├── L2: FIELD_TREE 子指标求和 (conf=0.85/0.7)
       │   └── L3: 会计恒等式推算 (conf=0.7, method=DERIVED)
       │   (含大陆RE拆分、利息嵌套、EBIT决策树)
       │   ── dict_gaps 收集 ──► dict_gap 表 ──► /dictionary 待审面板
       ▼
[M5 验证闸门]──G1复式平衡 → G2逻辑 → G3量级 → G4交叉 → G5完整
       │  (失败→L2/L3修复规则)
       ▼
[M6 Z-Score计算]──上市→Z原始 / 非上市→行业→Z′/Z″ → 风险区
       │
       ▼
[M7 输出+管理]──O1 JSON / O2 Excel(含因子明细) / O3 Web详情页
                  SupplierProfile + 批量 + 人工手填重算 + 删除级联
```

### 7.2 技术选型（已实现）

| 层 | 选型 | 说明 |
|----|------|------|
| 前端框架 | Next.js 16 (App Router, React 19, TypeScript, Tailwind v4) | 页面 + API 路由一体 |
| 持久层 | node:sqlite (DatabaseSync) | Node 内置，无需外部 DB |
| PDF 文本提取 | pdfplumber 0.11.x | 文本 + 表格，支持页码 |
| PDF 合并 | pypdf | 多文件上传时服务端合并 |
| PDF 扫描 OCR | GLM-4V-Flash | 视觉 OCR，替代原方案 tesseract |
| PPTX 提取 | python-pptx | 幻灯片文本与表格 |
| 科目映射 | FIELD_TREE 指标树 + 三级抓取链 | L1/L2/L3+DERIVED 逐级兜底 |
| 计算 / 校验 | Python 3.12+ + pydantic | Schema 校验 |
| 输出 | openpyxl（xlsx）+ Web 页面 | Excel 沿用现格式 + 因子明细 |
| 前端重算 | lib/zscore.ts (TypeScript) | Z 系数 / 阈值 / 因子分解，与引擎一致 |

### 7.3 关键源文件

| 文件 | 职责 |
|------|------|
| `zscore_pipeline/serve.py` | CLI 入口，JSON 单行输出 |
| `zscore_pipeline/pipeline.py` | 主流水线，PDF/PPTX 分流 |
| `zscore_pipeline/m4_map.py` | 三级抓取链核心（L1/L2/L3 + sanitize + dict_gaps） |
| `zscore_pipeline/synonym.py` | 字典加载 + match_component + suggest_field_for_gap |
| `zscore_pipeline/dict/synonyms.json` | 数据字典 v2（SYNONYMS + FIELD_TREE + EQUITY_INCL_MINORITY） |
| `zscore_pipeline/models.py` | 数据模型（ExtractMethod: L1/L2/derived/manual） |
| `zscore_pipeline/m2_extract_pptx.py` | PPTX 提取模块 |
| `zscore_pipeline/override.py` | 手动覆盖（MANUAL 模式） |
| `zscore-web/lib/db.ts` | node:sqlite 持久层（含 dict_gap 表） |
| `zscore-web/lib/engine.ts` | Python 子进程调用 |
| `zscore-web/lib/zscore.ts` | 前端 Z 值重算逻辑 |
| `zscore-web/lib/constants.ts` | Z 系数 / 阈值 / 因子元数据 |
| `zscore-web/app/dictionary/page.tsx` | 字典管理 + 待审面板 |

---

## 8. 数据模型（Schema）

### 8.1 ExtractMethod 枚举

```python
class ExtractMethod(str, Enum):
    L1 = "L1"           # 直接小计行命中
    L2 = "L2"           # 子指标求和
    DERIVED = "derived" # 会计恒等式推算
    MANUAL = "manual"   # 人工手填
    L3 = "L3"           # LLM 兜底（预留）
```

### 8.2 ExtractionResult（单份财报提取结果）

```python
class FieldValue(BaseModel):
    value: float | None
    method: Literal["L1", "L2", "derived", "manual", "L3"]
    source_page: int
    evidence: str
    confidence: float                         # 0~1

class ExtractionResult(BaseModel):
    supplier: str
    report_type: Literal["annual", "half", "quarterly"]
    period_months: int
    currency: str
    standard: str
    fields: dict[str, FieldValue]             # CA/CL/TA/TL/RE/EQ/EBIT/REV...
    balance_ok: bool                          # G1 复式平衡
    validation: list[ValidationIssue]         # G1-G5 结果
    dict_gaps: list[dict]                     # 未识别科目列表（label/value/page/sample/suggested_field）
```

### 8.3 ZScoreResult

```python
class ZScoreResult(BaseModel):
    model: Literal["Z", "Z_prime", "Z_double_prime"]
    X1, X2, X3, X4, X5: float
    X5_used: bool                             # Z″ 无 X5
    z_score: float
    zone: Literal["distress", "gray", "safe"]
    annualized: bool
    annualize_factor: float                   # 12/period_months
```

### 8.4 字典 v2 结构（synonyms.json）

```json
{
  "SYNONYMS": {
    "current_assets": ["流动资产合计", "流動資產合計", "current assets", ...],
    "current_liabilities": ["流动负债合计", "流動負債合計", ...],
    "total_assets": ["资产总计", "資產總計", ...],
    "total_liabilities": ["负债总计", "負債總計", "负债合计", ...],
    "equity_total": ["所有者权益合计", "權益總計", ...],
    "retained_earnings": ["保留盈餘", "留存收益", "retained earnings", ...],
    "re_retained_surplus": ["盈余公积", "盈余公積", ...],
    "re_undistributed": ["未分配利润", "未分配利潤", ...],
    "profit_before_tax": ["利润总额", "稅前淨利", ...],
    "interest_expense": ["其中：利息费用", "利息費用", ...],
    "revenue": ["营业收入", "營業收入", "revenue", ...]
  },
  "FIELD_TREE": {
    "current_assets": {
      "label": "流动资产合计",
      "components": {
        "货币资金": ["货币资金", "貨幣資金", "现金及约当现金", "現金及約當現金", ...],
        "应收账款": ["应收账款", "應收賬款", "应收帐款", "應收帳款", ...],
        "存货": ["存货", "存貨", ...],
        ...
      }
    },
    "current_liabilities": { ... },
    "total_assets": { ... },
    "total_liabilities": { ... },
    "equity_total": { ... },
    "retained_earnings": { ... }
  },
  "EQUITY_INCL_MINORITY": true
}
```

### 8.5 数据库表结构（SQLite）

| 表 | 说明 |
|----|------|
| `suppliers` | 供应商主数据（名称、地区、准则、行业、上市状态） |
| `runs` | 分析记录（供应商 ID、文件名、Z 值、风险区、原始结果 JSON、override JSON） |
| `dict_gap` | 待审科目（label、value、page、sample、suggested_field、status、resolution） |

---

## 9. 接口契约

### 9.1 Python CLI（内部调用）

```bash
python -m zscore_pipeline.serve \
  --pdf <path> \
  --industry manufacturing \
  --period annual \
  --standard CAS \
  --currency CNY \
  --listed false
# 输出：JSON 单行
```

### 9.2 Web API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/analyze` | 上传文件 → 调引擎 → 落库 → dict_gaps 入库 |
| GET | `/api/suppliers` | 供应商列表 |
| DELETE | `/api/suppliers` | 批量删除供应商（级联清理） |
| GET | `/api/suppliers/[id]` | 供应商详情 + 历史分析 |
| DELETE | `/api/suppliers/[id]` | 单个删除供应商 |
| GET | `/api/runs/[runId]` | 分析详情 |
| PATCH | `/api/runs/[runId]` | 手动修改字段 → 重算 Z 值 → 保存 override |
| GET | `/api/compare` | 对比数据（多批次） |
| GET | `/api/dictionary` | 获取字典 + 待审科目列表 |
| PUT | `/api/dictionary` | 更新字典（SYNONYMS + FIELD_TREE） |
| POST | `/api/dictionary/gaps` | 待审科目 approve（写回字典）/ ignore |

### 9.3 输出 JSON 示例（节选）

```json
{
  "supplier": "瀚邦为",
  "report_type": "annual",
  "period_months": 12,
  "currency": "CNY",
  "standard": "CAS",
  "fields": {
    "TA": {"value": 178711915.57, "method": "L1", "source_page": 5, "evidence": "资产总计 178,711,915.57", "confidence": 1.0},
    "CL": {"value": 45678901.23, "method": "L2", "source_page": 5, "evidence": "子指标求和", "confidence": 0.85},
    "TL": {"value": 89012345.67, "method": "derived", "source_page": 0, "evidence": "TL = TA - EQ", "confidence": 0.7}
  },
  "z_score": {"model": "Z_prime", "z": 2.3582, "zone": "gray", "annualized": false},
  "dict_gaps": [
    {"label": "應付帳款", "value": 1234567.89, "page": 5, "sample": "瀚邦为_2024-10.pdf", "suggested_field": "current_liabilities", "suggested_kind": "component"}
  ]
}
```

---

## 10. 关键技术规则与算法

### 10.1 Z-Score 公式（权威系数）

**Z（原始 1968，上市，5 因子）**
```
X1 = (CA − CL) / TA
X2 = RE / TA
X3 = EBIT / TA
X4 = 市值 / TL    （上市企业用市值，非账面价值）
X5 = REV / TA
Z = 0.012·X1 + 0.014·X2 + 0.033·X3 + 0.006·X4 + 0.999·X5
阈值：<1.81 破产区 | 1.81–2.99 灰色区 | >2.99 安全区
```

**Z′（1983，非上市制造业，5 因子）**
```
Z′ = 0.717·X1 + 0.847·X2 + 3.107·X3 + 0.420·X4 + 0.998·X5
阈值：<1.23 破产区 | 1.23–2.90 灰色区 | >2.90 安全区
```

**Z″（1995，非上市非制造业，4 因子）**
```
Z″ = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4   （无 X5）
阈值：<1.1 破产区 | 1.1–2.6 灰色区 | >2.6 安全区
```

### 10.2 三级抓取链算法

```
对每个 BS 字段 (CA, CL, EQ, RE, TA, TL):

1. sanitize: 过滤序号列（纯整数 1-999 且存在 ≥100K 大额值时）

2. L1 直接命中:
   result = match_field(label, SYNONYMS[field])
   if result and result.value >= max_component_value:
       return (result, method=L1, conf=1.0)
   # 值偏小则降级到 L2

3. L2 子指标求和:
   components = FIELD_TREE[field].components
   sum = 0; matched = 0; total = len(components)
   for comp_name, aliases in components:
       v = match_component(aliases, line_items)
       if v: sum += v; matched += 1
   coverage = matched / total
   if coverage >= 0.25:
       return (sum, method=L2, conf=0.85)
   else:
       return (sum, method=L2, conf=0.7)
   # TA/TL 特殊：流动部分可复用已解析的 CA/CL 值

4. L3 会计恒等式推算:
   TL = TA - EQ  (if TA, EQ resolved but TL not)
   EQ = TA - TL  (if TA, TL resolved but EQ not)
   TA = TL + EQ  (if TL, EQ resolved but TA not)
   CL = TL - 非流动负债  (if TL, 非流动负债 resolved)
   CA = TA - 非流动资产  (if TA, 非流动资产 resolved)
   return (derived_value, method=DERIVED, conf=0.7)

5. dict_gaps 收集:
   for item in line_items:
       if has_numeric_value(item) and
          match_field(item.label) is None and
          match_component(item.label) is None:
           gaps.append({label, value, page, sample, suggested_field})
```

### 10.3 字典自审闭环流程

```
分析财报
  ├── 三级抓取链执行
  ├── 收集 dict_gaps（有数值但无法匹配的科目）
  └── 返回结果 + gaps
       │
       ▼
/api/analyze 落库
  ├── 保存分析结果
  └── saveDictGaps(runId, sample, gaps) → dict_gap 表
       │
       ▼
/dictionary 页面
  ├── 展示字典内容（SYNONYMS + FIELD_TREE）
  └── 待审科目面板（status=pending 的 gaps）
       │                     │
       │     ┌───────────────┘
       │     ▼
       │  人工审核
       │     ├── 确认写回 → 写入 synonyms.json + resolveDictGap(resolved)
       │     └── 忽略 → resolveDictGap(ignored)
       │
       ▼
下次分析相同科目 → 自动命中 ✓
```

### 10.4 定期报告类型识别与流量年化

```
annualize_factor = 12 / period_months
# 年报 period_months=12 → factor=1（不年化）
# 半年报=6 → factor=2
# 季报=3 → factor=4

对【流量字段】(EBIT, REV) 应用因子：value_annualized = value × factor
对【存量字段】(CA,CL,TA,TL,EQ,RE) 不应用因子

⚠️ 实测：鸣志 2026Q1 不年化 Z′=1.428 vs 年化 Z′=1.910（差 0.48）
```

### 10.5 EBIT 推导决策树

```
IF 利润表有"利息费用/Finance costs"明细:
    EBIT = 利润总额/PBT + 利息费用  (conf=1.0)
ELIF 有"财务费用"但无利息明细 且 确认有借款:
    EBIT = PBT + 财务费用  (conf=0.9, 标记低置信)
ELIF 无借款迹象:
    EBIT = PBT  (conf=0.9)
交叉验证(G4): 现金流量表"支付之利息" 与 利息费用 偏差>20% → 标记复核
```

### 10.6 缺失字段修复规则（极简 BS 兜底）

- 无「流动资产合计」行 → L2 子指标求和（货币资金 + 应收 + 存货…）。
- 无「资产总计」→ L3 恒等式 TA = TL + EQ 推算。
- TA/TL 的「流动部分」可使用已解析的 CA/CL 值兜底。
- 无营收 → REV=0，Z″ 仍算（X5 不参与 Z″），标记「零收入」。

---

## 11. 测试策略

### 11.1 回归测试向量（6 基准 + 新增场景，人工核算 ground truth）

| 基准 | 地区/准则 | 模型 | Z（人工） | 风险区 | 验证重点 |
|------|----------|------|----------|--------|---------|
| 1 瀚荃 | 台湾/繁中 | Z′ | 2.248 | 灰色 | 繁体同义词、左右并排 BS |
| 2 QSP 2023 | 卡塔尔/英文/IFRS | Z″ | 10.891 | 安全 | OCR 通道、英文 IFRS |
| 3 麦弗瑞 | 香港/中英/极简BS | Z″ | −0.163 | 破产 | L3 恒等式修复、负权益、零收入 |
| 4 QSP 2022 | 卡塔尔/英文/IFRS | Z″ | 7.320 | 安全 | 半文本 PDF |
| 5 鸣志 Q1 | 大陆/CAS/季报 | Z′ | 1.910（×4年化） | 灰色 | 季报年化 |
| 6 鸣志年报 | 大陆/CAS/年报 | Z′ | 1.9365（不年化） | 灰色 | CAS 合并表、利息费用子行 |
| 7 瀚邦为（三表合并） | 大陆/CAS | Z′ | 2.3582 | 灰色 | 多文件 PDF 合并 |
| 8 瀚荃(TW)新样本 | 台湾/繁中 | Z′ | — | — | 字典自审闭环（應付帳款/應收票據淨額/現金及約當現金 gap 发现→写回→重跑命中） |

**强断言**：基准 5 与基准 6 必须**同时命中**（年报 1.94 与季报年化 1.91），作为年化路径的双重回归。

### 11.2 测试层级

- **单元测试**：每个映射函数、年化函数、EBIT 决策树分支、sanitize 函数。
- **集成测试**：6 基准 + 新场景端到端（文件 → Z），逐字段比对。
- **边界测试**：麦弗瑞（负权益 / 零收入 / 极简 BS）、TL=0（X4=N/A）、非整数页码、序号列干扰。
- **字典自审测试**：新样本 → dict_gaps 入库 → /dictionary 审批 → 写回 → 重跑命中。
- **手填重算测试**：修改字段 → Z 值即时更新 → 结果持久化。
- **删除级联测试**：删除供应商 → 关联 runs / 字段 / 文件全部清理。
- **回归门禁**：每次改动提取 / 计算逻辑，重跑全量基准，误差 < 1% 且风险区一致方可合入。

---

## 12. 实施路线图

### Phase 1：核心跑通 ✅ 已完成
- M1–M3 分类 + 双通道 + 报表定位
- M4 L1+L2（含大陆 RE 拆分、利息嵌套）
- 报告类型识别 + 流量年化
- M6 Z′/Z″ 计算；Excel 输出
- **验收**：6 基准误差 < 1%，风险区一致

### Phase 2：验证与智能 ✅ 已完成
- M5 五道闸门 + 修复规则
- M4-L3 LLM 兜底预留
- 行业 → 模型自动选择
- Web 详情页复核
- **验收**：麦弗瑞自动修复算出 Z″=−0.16

### Phase 3：Web 平台与生产化 ✅ 已完成
- Next.js Web 平台（上传 / 详情 / 对比 / 供应商库）
- node:sqlite 持久层
- 批量处理 + 断点续跑 + 部分失败隔离
- SupplierProfile 管理 + 历史趋势
- **验收**：10 份混合格式批量跑通

### Phase 4：字典智能化与体验升级 ✅ 已完成（v2.0）
- 字典 v2：FIELD_TREE 指标树 + 子指标别名
- 三级抓取链（L1 直接 / L2 求和 / L3 恒等式推算 DERIVED）
- 序号防误抓（sanitize）
- 字典自审闭环（dict_gaps → 待审面板 → 写回）
- 人工手填 + 确认标注 + 实时重算
- PPTX 支持
- 多文件上传 + PDF 合并
- 供应商管理 + 级联删除
- 上市 / 非上市双模型
- Excel 导出含因子明细
- **验收**：新样本自动发现 gaps 并写回字典；三表合并 Z 值正确；PPTX 端到端跑通

### Phase 5：待规划
- 月报 period_type 支持（annualize_factor = 12/months）
- 图片报表 OCR 鲁棒性提升（多 prompt 投票 / 升级 GLM-4.6v / paddleocr 布局识别）
- G5 闸门 PATCH 后刷新
- 多用户鉴权与权限隔离

---

## 13. 风险矩阵

| 风险 | 概率 | 影响 | 缓解 | 状态 |
|------|------|------|------|------|
| OCR 数字识别错误（,↔. / 0↔O） | 高 | 高 | G3 量级校验；序号防误抓；异常值重 OCR | ✅ 已缓解 |
| 新地区科目未入库 | 高 | 中 | 字典自审闭环（dict_gaps → 写回） | ✅ 已解决 |
| 扫描件无文本层且 OCR 全崩 | 中 | 中 | 返回 422 待处理；人工手填重算 | ✅ 已缓解 |
| EBIT 口径判断错误 | 中 | 高 | 决策树 + G4 现金流交叉 + 低置信标记 | ✅ 已缓解 |
| 图片型 PDF OCR 非确定性 | 中 | 中 | 序号防误抓；人工手填修正 | ⚠️ 部分缓解，待 Phase 5 |
| LLM 数据隐私泄露 | 中 | 高 | 本地处理；云 API 仅发数值页、脱敏公司名 | ✅ 已实现 |
| Altman 阈值不适用中国民企 | 中 | 中 | threshold_override 支持微调；报告标注限制 | ✅ 已实现 |
| 极端样本导致异常 | 低 | 中 | 麦弗瑞基准覆盖；TL=0 时 X4=N/A 防御 | ✅ 已实现 |

---

## 14. 附录

### 14.1 已知格式覆盖率（v2.0）

| 格式特征 | 覆盖样本 | 通道 | 状态 |
|---------|---------|------|------|
| 电子文本 + 繁中 + 左右并排 BS | 瀚荃 | pdfplumber | ✅ |
| 扫描 + 中英 + 极简 BS（无合计行） | 麦弗瑞 | OCR + L3 修复 | ✅ |
| 半文本 + 英文 + IFRS | QSP 2022 | pdfplumber | ✅ |
| 纯扫描 + 英文 + IFRS | QSP 2023 | OCR | ✅ |
| 电子文本 + 大陆 CAS + 合并 / 母公司双套 + 季报 | 鸣志 Q1 | pdfplumber + 年化 | ✅ |
| 电子文本 + 大陆 CAS + 合并 + 年报 | 鸣志年报 | pdfplumber | ✅ |
| 多 PDF 合并（三表分册） | 瀚邦为 | pypdf 合并 + pdfplumber | ✅ |
| 繁体新科目（應付帳款/應收票據淨額/現金及約當現金） | 瀚荃 TW 新样本 | 字典自审闭环 | ✅ |
| PPTX 格式财报 | 测试样本 | python-pptx | ✅ |
| 图片型 PDF（序号列干扰） | 瀚邦为月报 | GLM-4V OCR + 序号防误抓 | ⚠️ 部分覆盖 |
| 大陆非上市单体简中 BS | 未覆盖 | — | ⚠️ 建议补充 |
| 月报 | 未覆盖 | — | ⚠️ Phase 5 |

### 14.2 开放问题（需用户 / 业务确认）

1. 行业分类（制造 vs 服务）的来源：人工标注还是系统启发式？→ **已决定**：默认人工标注，未标注时启发式 + 低置信标记。
2. 非上市单体样本是否可补充？→ 待补充。
3. 中国民企阈值是否需本地化校准？→ 沿用 Altman 原阈值并标注限制，支持 threshold_override。
4. 月报 period_type 是否需要支持？→ Phase 5 规划中。
5. 图片型 PDF OCR 鲁棒性提升方案选择？→ Phase 5 评估多 prompt 投票 / GLM-4.6v / paddleocr。

### 14.3 字段提取方式说明

| method | 含义 | UI 标记 | 置信度 |
|--------|------|---------|--------|
| `L1` | 直接命中字段小计行 | 正常 | 1.0 |
| `L2` | 子指标求和 | 正常 | 0.85 / 0.7 |
| `derived` | 会计恒等式推算 | 「推算待确认」（黄色） | 0.7 |
| `manual` | 人工手填 | 「待确认」（黄色） | — |
| `L3` | LLM 兜底（预留） | 低置信标记 | < 0.8 |

---

> 本 PRD v2.0 与方案设计 v2.2 互为补充：PRD 定义「做什么 / 做到什么程度」，方案设计定义「怎么做 / 算法细节」。v2.0 反映了截至 2026-08-19 的全部已实现功能，作为后续迭代的基线。
