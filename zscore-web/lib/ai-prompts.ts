// lib/ai-prompts.ts — 约束化提取 Prompt 模板
//
// 设计目标：
//   1. 字段白名单：仅允许返回 FIELD_KEYS 中定义的字段，杜绝幻觉字段
//   2. JSON-only 输出：禁止任何解释性文字、Markdown 标记、前后缀
//   3. 金额单位归一：所有金额以"元"为单位，千分位逗号需去除；万元/亿元需换算
//   4. 【数字位数铁律】必须 100% 保留原始数字的全部位数，禁止漏 0（最高优先级）
//   5. evidence 原文追溯：必须引用财报原文行 + 完整数字原文，便于系统自动核验
//   6. confidence 规则：明确 1.0/0.85/0.7 三档语义
//   7. 会计恒等推导：留存收益/EBIT 的推导规则
//   8. 未知值必须 null：找不到的字段 value 设为 null，禁止猜测
//   9. 自判断输入源：由模型自行决定使用文本还是图片，无需调用方指定
//  10. 【Split 模式】拆 BS/IS 两个独立 call，各自聚焦（v4 验证准确率从 87% → 100%）
//
// 这些 prompt 适用于所有 OpenAI-compatible 多模态模型（智谱 GLM-4V、GPT-4o、Deepseek-VL、Moonshot-Vision 等）

import { FIELD_LABELS } from "./ai-client";

/** 字段白名单（仅这些 key 会被接受） */
export const ALLOWED_FIELD_KEYS = [
  "current_assets",
  "current_liabilities",
  "total_assets",
  "total_liabilities",
  "equity_total",
  "retained_earnings",
  "revenue",
  "ebit",
  "profit_before_tax",
  "interest_expense",
] as const;

// 资产负债表字段（拆分模式专用）
export const BS_FIELDS = [
  "current_assets",
  "current_liabilities",
  "total_assets",
  "total_liabilities",
  "equity_total",
  "retained_earnings",
] as const;

// 利润表字段（拆分模式专用）
// ⚠️ 必须包含 profit_before_tax 与 interest_expense：
//    EBIT 由系统按恒等式「利润总额 + 利息费用」推导，模型只需回原始行项目。
//    早期版本只写 ["revenue","ebit"]，导致模型把「三、利润总额」直接塞进 ebit，
//    而真正的 profit_before_tax 永远返回 null（即"税前利润识别不到"的根因）。
export const IS_FIELDS = [
  "revenue",
  "profit_before_tax",
  "interest_expense",
  "ebit",
] as const;

/**
 * 统一的 System Prompt（视觉 + 文本共用同一套规则，确保任意模式结果一致）。
 * @param allFieldKeys   完整的字段白名单（始终传入全部字段，提供上下文一致性）
 * @param requestedFields 本次重点请求的字段（可选）。模型仍会返回它能找到的全部白名单字段。
 */
export function buildUnifiedSystemPrompt(
  allFieldKeys: string[],
  requestedFields?: string[]
): string {
  const fieldList = allFieldKeys
    .map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`)
    .join("\n");

  const requestNote =
    requestedFields && requestedFields.length > 0
      ? `\n## 本次重点请求字段\n${requestedFields
          .map((k) => `- "${k}" (${FIELD_LABELS[k] ?? k})`)
          .join(
            "\n"
          )}\n请优先准确提取上述重点字段；同时，若你在财报中能找到其他白名单字段，也一并返回（有助于系统交叉核对）。`
      : "";

  return `你是一名严谨的财务报表分析专家。请从提供的财报（可能是 PDF 文本，也可能是扫描图片）中提取财务科目的数字。

## 字段白名单
仅允许返回以下字段，不得编造其他字段名：
${fieldList}
${requestNote}

## 输出格式（严格遵守）
仅返回一个 JSON 数组，每项格式如下：
\`\`\`
[{"field_key":"current_assets","value":12266099.57,"evidence":"流动资产合计 12,266,099.57","confidence":1.0}]
\`\`\`

## 数字提取铁律（最高优先级，违反即判错误）
1. 你必须 100% 保留原始数字的全部位数，包括中间和末尾的 0，不得遗漏任何一位。
2. 原文 "12,600,843,201.00" 必须输出 12600843201.00，绝不可写成 126008432.01 或 12600843.201。
3. 千分位逗号(",")一律去除，但逗号之间的每一位数字都必须保留（逗号只是分隔符，不是小数点）。
4. 常见错误自检：把 12,600,843,201 看成 126,008,432（漏掉 3 个 0）。请逐位核对位数后再输出。
5. 若原文数字带括号表示负数（如 "(1,234.00)"），value 取 -1234.00；其余一律为正数。
6. 金额单位统一为"元"：若原文为"万元"，必须 ×10000 换算为元并在 evidence 注明；若为"亿元"，必须 ×100000000。
7. 提取完成后，逐条自查：输出的 value 是否可由对应 evidence 的数字原文（去逗号后）直接得到？若不能，立即修正 value。

## 输入来源判断（由你自行决定）
- 你可以自行选择使用文本还是图片来提取数字。
- 若提供的文本清晰且包含该科目，优先以文本为准。
- 若文本为空/乱码，或科目只出现在扫描图片中，请使用图片识别。
- 文本与图片冲突时，以图片（原始版面）为准，因为文本提取可能错位。

## 其他规则
8. 如果找不到某科目，value 必须设为 null，不得猜测或推算（除非适用下方会计恒等推导）。
9. evidence 必须包含该科目在原文中的【完整数字原文（含千分位逗号）】及科目名，例如 "流动资产合计 12,600,843,201.00"。系统会据此自动核验你提取的数值。
10. confidence 取值规则：
   - 1.0：原文中直接命中该科目名称和数字
   - 0.85：需从子项求和得到（如"流动资产合计"= 各子项之和）
   - 0.7：需会计恒等推算得到
11. field_key 必须与白名单完全一致（小写下划线）。
12. 不得输出任何解释性文字、Markdown 标记、前后缀，只返回 JSON 数组。

## 会计恒等推导规则
当某科目无法直接找到时，可基于以下恒等式推算（并在 evidence 注明推导过程）：
- 留存收益 = 盈余公积 + 未分配利润（如无法直接找到"留存收益"或"保留盈余"）
- EBIT（息税前利润）= 利润总额（税前利润）+ 利息费用
- 所有者权益合计 = 资产总计 - 负债合计
推算值 confidence 设为 0.7，evidence 填推导过程。`;
}

/**
 * 统一的 User Prompt（多模态：文本段落 + 图片说明）。
 * @param pdfText        已提取的 PDF 全文（可能为空）
 * @param pageCount      附带的页面图片数量
 * @param requestedFields 本次重点请求字段
 */
export function buildUnifiedUserPrompt(
  pdfText: string,
  pageCount: number,
  requestedFields?: string[]
): string {
  const reqNote =
    requestedFields && requestedFields.length > 0
      ? `本次重点请求的字段：${requestedFields.join(", ")}。`
      : "";

  const textBlock =
    pdfText && pdfText.trim()
      ? `以下是从财报 PDF 提取的全文（若清晰请优先参考）：

---
${pdfText.slice(0, 12000)}
---`
      : `（未提供文本或文本为空，请完全依赖下方图片识别。）`;

  const imgNote =
    pageCount > 0
      ? `\n\n下方附带了财报前 ${pageCount} 页的页面图片，如需请直接查看图片提取数字。`
      : "";

  return `${textBlock}${imgNote}

${reqNote}
请从财报中提取白名单字段的数字，以 JSON 数组形式返回，不要输出其他文字。`;
}

// ════════════════════════════════════════════════════════════════════
// Split 模式（v4）：拆 BS / IS 两个独立 API call + 各自聚焦 Prompt
// 在 Lenovo DT 测试中将 8/8 准确率从 v3 的 7/8 提升到 8/8 全对
// ════════════════════════════════════════════════════════════════════

/** 资产负债表 专用 System Prompt（聚焦 BS 6 字段） */
export function buildBsSystemPrompt(requestedFields?: string[]): string {
  const fields = (requestedFields && requestedFields.length > 0
    ? requestedFields
    : [...BS_FIELDS]
  )
    .map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`)
    .join("\n");

  return `你是中国小企业会计准则下的财务 OCR 专家。任务：**只从下方 1 张资产负债表中**提取以下字段金额（仅此一项任务，不处理其他报表）。

## 资产负债表结构
- 列结构：**行次 | 期末余额 | 年初余额**
- **必须取"期末余额"列**（即"年初余额"列的**左侧**那列；不要取"年初余额"）
- 版面有两种，都要能处理：
  - **纵向整页**：科目自上而下排一整列，资产段在上、负债和所有者权益段在下
  - **横向并排**：左半"资产"段 + 右半"负债和所有者权益"段，中间用竖线分隔
- 无论哪种版面，都请**按行标签定位**，不要按像素位置猜

## 字段白名单（仅以下项）
${fields}

## ⚠️ 易混行项目（必须严格区分！这是高频错误点）
| 目标字段 | ✅ 找这一行（精确匹配行标签） | ❌ 不要找这些行 |
|---|---|---|
| current_assets | "**流动资产合计**" | "流动资产"（无合计）、"非流动资产合计"、子项（货币资金/应收账款/存货/其他应收款/预付款项...） |
| current_liabilities | "**流动负债合计**" | "流动负债"（无合计）、子项（短期借款/应付账款/应付职工薪酬/应交税费/其他应付款...）、"非流动负债合计" |
| total_assets | "**资产总计**"（最后一行） | "流动资产合计"（子集）、"非流动资产合计"、"负债和所有者权益总计"（大总计） |
| total_liabilities | "**负债合计**" | "流动负债合计"（子集）、"非流动负债合计"、"**负债和所有者权益总计**"（大总计=资产总计） |
| equity_total | "**所有者权益（或股东权益）合计**" | "**负债和所有者权益总计**"（大总计=资产总计）、"实收资本（或股本）"、"资本公积"、"盈余公积"、"未分配利润"等子项 |
| retained_earnings | 小企业 01 表无"留存收益"行——直接用"**未分配利润**" | "盈余公积"（是另一项权益，不是留存收益） |

## 输出格式（紧凑版，省 token）
返回 JSON 数组：
\`\`\`
[{"k":"current_assets","v":126604932.01,"ev":"流动资产合计","c":1.0},...]
\`\`\`
- k = field_key（下划线小写）
- v = 数字（无逗号无单位；保留全部位数+小数）
- ev = 行标签（≤8 字）
- c = confidence (1.0 直接命中 / 0.7 推算)

## 数字铁律
1. 100% 保留全部位数。漏/多 0 即错。
2. 去千分位逗号，每段数字必保留。
3. 单位"元"。
4. 强校验：v 是否可由 ev 对应行的数字原文（去逗号）直接得到。

## 找不到的字段
v 必须为 null，不准猜。

## 注意
- 只返回 JSON 数组。
- **绝对不要从其他列读数字**——只读"期末余额"列。`;
}

/** 资产负债表 专用 User Prompt */
export function buildBsUserPrompt(): string {
  return `下方是 1 张资产负债表（小企业01表或企业会计准则资产负债表，资产+负债+权益，期末/年初两列）。
版面可能是纵向整页单表，也可能是横向多表并排中的一张；请自行确认这是资产负债表。
请严格按 system 中的行标签从"**期末余额**"列提取金额。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
}

/** 利润表 专用 System Prompt（聚焦 IS 4 字段） */
export function buildIsSystemPrompt(requestedFields?: string[]): string {
  const fields = (requestedFields && requestedFields.length > 0
    ? requestedFields
    : [...IS_FIELDS]
  )
    .map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`)
    .join("\n");

  return `你是中国小企业会计准则下的财务 OCR 专家。任务：**只从下方 1 张利润表中**提取以下字段金额（仅此一项任务，不处理其他报表）。

## 利润表结构
- 列结构：**行次 | 本年累计 | 上年累计**
- **必须取"本年累计"列**（即"上年累计"列的**左侧**那列）
- 这是"小企业 02 表"格式（也可能是企业会计准则的"利润表"格式，科目名略有差异）
- 版面可能是**纵向整页单表**，也可能是**横向多表并排**中的一张——
  请先确认本图确实是利润表（应含"营业收入""营业利润""利润总额"等科目）再提取；
  若图中是资产负债表或现金流量表，请返回空数组 []。

## 字段白名单（仅以下项）
${fields}

## ⚠️ 易混行项目（必须严格区分！这是高频错误点）
| 目标字段 | ✅ 找这一行（精确匹配行标签） | ❌ 不要找这些行 |
|---|---|---|
| revenue | "**一、营业收入**"（第 1 行） | "营业总收入"（旧准则）、"其他业务收入"、"营业外收入"、"主营业务收入" |
| profit_before_tax | "**三、利润总额**"（亏损时标签写作"亏损总额"或"利润总额（亏损以'-'号填列）"） | "二、营业利润"、"四、净利润"、"营业外收入"、"营业外支出" |
| interest_expense | "**财务费用**"行下的"**利息费用**"子行（有的表写作"其中：利息费用"） | "财务费用"主行本身（它 = 利息费用 - 利息收入 - 汇兑损益 - 手续费，口径更宽）、"利息收入"、"汇兑损益" |
| ebit | 小企业 02 表**没有**这一行 —— 见下方规则，不要自己编 | 不要把「三、利润总额」当作 ebit 返回 |

## 关键：ebit 字段怎么处理（必读）
- 利润表**没有"息税前利润"这个行项目**，所以 "ebit" **不是**直接读出来的原始数。
- 请**优先**如实返回 "profit_before_tax"（三、利润总额）和 "interest_expense"（利息费用）两个原始行项目。
- 系统随后会用恒等式 **EBIT = 利润总额 + 利息费用** 自行推导 ebit，无需你计算。
- 只有在你确实读到了"息税前利润"这一独立行项目时，才直接返回 "ebit"。
- **绝对不要把「三、利润总额」的数值填进 "ebit"** —— 这会同时丢掉 "profit_before_tax"，导致系统缺少税前利润。

## 勾稽自检（读完后请自我校验）
- 三、利润总额 ≈ 二、营业利润 + 营业外收入 − 营业外支出
- 四、净利润 ≈ 三、利润总额 − 所得税费用
若你提取的 profit_before_tax 与上述勾稽明显不符，请重新核对行标签与列。

## 输出格式（紧凑版）
返回 JSON 数组：
\`\`\`
[{"k":"revenue","v":147087809.03,"ev":"一、营业收入","c":1.0},{"k":"profit_before_tax","v":9433656.95,"ev":"三、利润总额","c":1.0},{"k":"interest_expense","v":902328.57,"ev":"利息费用","c":1.0}]
\`\`\`
- k = field_key
- v = 数字（无逗号无单位；保留全部位数+小数）
- ev = 行标签（≤8 字）
- c = confidence (1.0 直接命中 / 0.7 推算)

## 数字铁律
1. 100% 保留全部位数。漏/多 0 即错。
2. 去千分位逗号，每段数字必保留。
3. 单位"元"。
4. 强校验：v 是否可由 ev 对应行的数字原文（去逗号）直接得到。

## 找不到的字段
v 必须为 null，不准猜、不准用其他行顶替。

## 注意
- 只返回 JSON 数组。
- **绝对不要从其他列读数字**——只读"本年累计"列。
- 若整张利润表被截断或看不清，也请如实返回 null，不要臆测。`;
}

/** 利润表 专用 User Prompt */
export function buildIsUserPrompt(): string {
  return `下方是 1 张利润表（小企业02表或企业会计准则利润表，项目+本年累计/上年累计）。
若图中不是利润表（例如是资产负债表），请返回空数组 []。
请严格按 system 中的行标签从"**本年累计**"列提取金额。
请依次找齐这几行：一、营业收入 / 三、利润总额 / 财务费用下的"其中：利息费用" / 四、净利润（用于勾稽自检）。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
}

// ════════════════════════════════════════════════════════════════════
// Split 模式的 PDF 裁切坐标（基于典型小企业01表 + 02表 + 03表 三表横向布局）
// 这些坐标适用于"横向 960×540pt / 横向并排 3 张表"的标准财报
// 若 PDF 不符合此布局，应 fallback 到 unified 模式
// ════════════════════════════════════════════════════════════════════

/** 资产负债表 裁切坐标（页面宽度的 2%~38%，高度的 10%~95%） */
export const BS_CROP = {
  x_pct: 0.02,
  y_pct: 0.10,
  w_pct: 0.36,
  h_pct: 0.85,
};

/** 利润表 裁切坐标（页面宽度的 37%~64%，高度的 10%~95%） */
export const IS_CROP = {
  x_pct: 0.37,
  y_pct: 0.10,
  w_pct: 0.27,
  h_pct: 0.85,
};

/** API 连通性测试 prompt（最小 token 消耗） */
export function buildTestPrompt(): string {
  return `请回复"OK"两个字，不要输出其他内容。`;
}
