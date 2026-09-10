// scripts/test-ai-extract.mjs
// AI 提取准确率迭代测试 harness
// 用法:
//   node scripts/test-ai-extract.mjs [pdf-path] [prompt-version] [dpi]
//   例如: node scripts/test-ai-extract.mjs  v1 250
//         node scripts/test-ai-extract.mjs  v2 300
//
// 输出: 原始 response + 字段级 ground-truth 对比表

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Ground truth for Lenovo DT 2024-Q4 财务报告 ─────────────────────
// 主目标（8 个，由用户提供）
const GROUND_TRUTH = {
  current_assets:      126604932.01,
  current_liabilities:  61738437.72,
  total_assets:        135763458.93,
  total_liabilities:    61738437.72,
  equity_total:         74025021.21,
  retained_earnings:    16805621.21,
  revenue:            147087809.03,
  ebit:                  9433656.95,  // = 利润总额（此报告 EBIT 定义）
};
// 支持字段（仅记录，不参与评分）
const SUPPORTING_TRUTH = {
  profit_before_tax:    9433656.95,
  interest_expense:      902328.57,
  paid_in_capital:      26151869.00,
  capital_reserve:      31067531.00,
  paid_in_capital_label: "实收资本(或股本)",
  capital_reserve_label: "资本公积",
};

const FIELD_LABELS = {
  current_assets: "流动资产合计",
  current_liabilities: "流动负债合计",
  total_assets: "资产总计",
  total_liabilities: "负债合计",
  equity_total: "所有者权益合计",
  retained_earnings: "留存收益",
  revenue: "营业收入",
  ebit: "息税前利润/利润总额",
  profit_before_tax: "利润总额",
  interest_expense: "利息费用",
};

const ALL_KEYS = Object.keys(GROUND_TRUTH);

// ── Load AI config ─────────────────────────────────────────────────
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/ai-config.json"), "utf-8")
);
console.log(`Config: provider=${cfg.provider} model=${cfg.vision_model} base=${cfg.base_url}`);

// ── PDF → PNG base64 ──────────────────────────────────────────────
function pdfToBase64Png(pdfPath, dpi = 200) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-"));
  try {
    execFileSync(
      "pdftoppm",
      ["-png", "-r", String(dpi), pdfPath, path.join(tmp, "p")],
      { timeout: 60000, stdio: "pipe" }
    );
    const files = fs
      .readdirSync(tmp)
      .filter((f) => f.endsWith(".png"))
      .sort();
    return files.map((f) => fs.readFileSync(path.join(tmp, f)).toString("base64"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 高级裁切（使用 PIL）─────────────────────────────────────────
// 输入 PDF，返回 [{label, base64}, ...] 列表
// crops: { label, x_pct, y_pct, w_pct, h_pct } 比例裁切（0..1），或 {label, full:true}
async function pdfToCropsBase64(pdfPath, dpi, crops, opts = {}) {
  // 1) 渲染全页到 PNG
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harness-"));
  let pngPath;
  try {
    execFileSync(
      "pdftoppm",
      ["-png", "-r", String(dpi), pdfPath, path.join(tmp, "p")],
      { timeout: 60000, stdio: "pipe" }
    );
    pngPath = path.join(tmp, fs.readdirSync(tmp).find(f => f.endsWith(".png")));
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }

  // 2) 用 PIL 裁切
  const { spawnSync } = await import("node:child_process");
  const pyCode = `
import sys
from PIL import Image, ImageEnhance, ImageOps
img = Image.open(${JSON.stringify(pngPath)})
W, H = img.size
import json
crops = json.loads(sys.stdin.read())
results = []
for i, c in enumerate(crops):
    if c.get("full"):
        region = img
    else:
        x = int(c.get("x_pct", 0) * W)
        y = int(c.get("y_pct", 0) * H)
        w = int(c.get("w_pct", 1) * W)
        h = int(c.get("h_pct", 1) * H)
        region = img.crop((x, y, x + w, y + h))
    if c.get("invert"):
        region = ImageOps.invert(region.convert("RGB"))
    if c.get("enhance"):
        region = ImageEnhance.Contrast(region).enhance(c["enhance"])
    if c.get("scale") and c["scale"] != 1.0:
        nw, nh = int(region.size[0] * c["scale"]), int(region.size[1] * c["scale"])
        region = region.resize((nw, nh), Image.LANCZOS)
    out = f"${tmp.replace(/\\/g, "\\\\")}/crop_{i}.png"
    region.save(out, "PNG", optimize=False)
    results.append({"label": c.get("label", f"crop_{i}"), "path": out})
print(json.dumps(results))
`;
  const py = spawnSync("python3", ["-c", pyCode], {
    input: JSON.stringify(crops),
    encoding: "utf-8",
    timeout: 60000,
  });
  if (py.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error("PIL crop failed: " + py.stderr);
  }
  const cropResults = JSON.parse(py.stdout);
  const out = cropResults.map((c) => ({
    label: c.label,
    base64: fs.readFileSync(c.path).toString("base64"),
  }));
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

// ── Chat URL builder ──────────────────────────────────────────────
function buildChatUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v4") || base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

// ── API call ──────────────────────────────────────────────────────
async function callApi(imagesB64, system, user, opts = {}) {
  const url = buildChatUrl(cfg.base_url);
  const model = opts.model || cfg.vision_model;
  const userContent = [{ type: "text", text: user }];
  for (const img of imagesB64) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${img}` },
    });
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.api_key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      temperature: opts.temperature ?? 0,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return {
    status: resp.status,
    content: data?.choices?.[0]?.message?.content ?? "",
    data,
    raw: text,
  };
}

// ── JSON parser (兼容 ```json 包裹) ───────────────────────────────
function parseResult(content) {
  let raw = content.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) raw = fence[1].trim();
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// ── Compare to ground truth ──────────────────────────────────────
function compare(extracted) {
  const results = [];
  for (const k of ALL_KEYS) {
    // 兼容长键 (field_key) 和短键 (k)
    const item = extracted?.find?.(
      (x) => x.field_key === k || x.k === k
    );
    let v = item?.value ?? item?.v;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/,/g, ""));
      v = isFinite(n) ? n : null;
    }
    const evidence = item?.evidence ?? item?.ev ?? "";
    const confidence = item?.confidence ?? item?.c;
    const truth = GROUND_TRUTH[k];
    const err = typeof v === "number" ? Math.abs(v - truth) : null;
    const rel = err != null && truth ? err / truth : null;
    const exact = v != null && err < 0.01;
    const close5pct = v != null && rel != null && rel < 0.05;
    const status = v == null ? "⏳空" : exact ? "✅" : close5pct ? "🟡近" : "❌";
    results.push({
      field: k,
      label: FIELD_LABELS[k],
      truth,
      extracted: v,
      err,
      rel,
      status,
      evidence,
      confidence,
    });
  }
  return results;
}

function renderTable(results) {
  console.log(
    "\n| 字段 | 标签 | 正确值 | 提取值 | 绝对误差 | 相对误差 | 状态 | confidence |"
  );
  console.log("|---|---|---:|---:|---:|---:|:---:|---:|");
  for (const r of results) {
    const fmt = (n) =>
      n != null
        ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "—";
    const err = r.err != null ? r.err.toFixed(2) : "—";
    const rel = r.rel != null ? (r.rel * 100).toFixed(4) + "%" : "—";
    const conf = r.confidence != null ? r.confidence.toFixed(2) : "—";
    console.log(
      `| ${r.field} | ${r.label} | ${fmt(r.truth)} | ${fmt(r.extracted)} | ${err} | ${rel} | ${r.status} | ${conf} |`
    );
  }
}

// ════════════════════════════════════════════════════════════════════
// PROMPT VERSIONS — 在这里迭代
// ════════════════════════════════════════════════════════════════════

const PROMPTS = {};

// v0: 当前 lib/ai-prompts.ts 的 buildUnifiedSystemPrompt 完整拷贝
PROMPTS.v0 = {
  system: (allKeys) => {
    const fieldList = allKeys.map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`).join("\n");
    return `你是一名严谨的财务报表分析专家。请从提供的财报（可能是 PDF 文本，也可能是扫描图片）中提取财务科目的数字。

## 字段白名单
仅允许返回以下字段，不得编造其他字段名：
${fieldList}

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
  },

  user: (pdfText, pageCount, requestedFields) => {
    const textBlock = pdfText && pdfText.trim()
      ? `以下是从财报 PDF 提取的全文（若清晰请优先参考）：\n\n---\n${pdfText.slice(0, 12000)}\n---`
      : `（未提供文本或文本为空，请完全依赖下方图片识别。）`;
    const imgNote = pageCount > 0 ? `\n\n下方附带了财报前 ${pageCount} 页的页面图片，如需请直接查看图片提取数字。` : "";
    return `${textBlock}${imgNote}\n\n请从财报中提取白名单字段的数字，以 JSON 数组形式返回，不要输出其他文字。`;
  },
};

// v1: 增加字段级精确提示（"流动资产合计"而不是"流动资产"），列顺序 + 跨表识别
// v1 关键改进: 短键 k/v 节省 token; 显式区分易混行
PROMPTS.v1 = { ...PROMPTS.v0 };

PROMPTS.v1.system = (allKeys) => {
  const fieldList = allKeys.map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`).join("\n");
  return `你是一名中国会计准则下的财务数字 OCR 专家。从扫描件财报中提取以下字段的【金额数字】。

## 输入
单页扫描件，横向并排 3 张表：左 资产负债表 | 中 利润表 | 右 现金流量表(忽略)。

## 字段白名单
${fieldList}

## ⚠️ 易混行项目（必须严格区分）
| 目标字段 | ✅ 找这一行（精确匹配行标签） | ❌ 不要找这些行 |
|---|---|---|
| current_assets | "**流动资产合计**" | "流动资产"（无"合计"）、"非流动资产合计"、任何子项（货币资金/应收账款/存货...） |
| current_liabilities | "**流动负债合计**" | "流动负债"（无合计）、任何子项（短期借款/应付账款/应付职工薪酬...）、"非流动负债合计" |
| total_assets | "**资产总计**" | "流动资产合计"（只是子集）、"非流动资产合计"、"负债和所有者权益总计" |
| total_liabilities | "**负债合计**" | "流动负债合计"（只是子集）、"非流动负债合计"、"**负债和所有者权益总计**"（这是大总计=资产总计）、"负债和股东权益总计" |
| equity_total | "**所有者权益合计**"或"股东权益合计" | "**负债和所有者权益总计**"（这是大总计！）、"实收资本"、"资本公积"等子项 |
| retained_earnings | "**留存收益**"或"保留盈余"；否则 = 盈余公积 + 未分配利润 | 任何单独项 |
| revenue | "**营业收入**" | "营业总收入"（旧准则、含利息）、"其他业务收入"、"营业外收入" |
| ebit | "**息税前利润**"；否则 = 利润总额 + 利息费用 | "营业利润"、"利润总额"、"净利润" |

## 取哪一列
- 资产负债表类（流动/总资产/总负债/股东权益/留存）：取"**期末余额**"或"本年累计"列（左表最右列）
- 利润表类（营业收入/EBIT）：取"**本年累计**"或"本期金额"列（中表最右列）

## 输出格式（紧凑版，省 token）
返回 JSON 数组：
\`\`\`
[{"k":"current_assets","v":126604932.01,"ev":"流动资产合计","c":1.0},{"k":"current_liabilities","v":61738437.72,"ev":"流动负债合计","c":1.0},...]
\`\`\`
- k = field_key
- v = 数字（不要带逗号；不要带单位；保留全部位数+小数）
- ev = 行标签（≤10 字）
- c = confidence (1.0 直接命中 / 0.85 子项求和 / 0.7 会计恒等)

## 数字铁律（最高优先级）
1. 100% 保留全部位数。原文 126,604,932.01 → 126604932.01。漏/多 0 即错。
2. 去千分位逗号，但每段每个数字都保留。
3. 单位统一"元"。原文"万元"×10000；"亿元"×100000000。
4. 括号 (1,234.00) → -1234.00。
5. 自检：输出后逐条检查，v 是否可由 ev 对应行的数字原文（去逗号）直接得到。

## 找不到的字段
- v 必须为 null，不准猜。
- 推算值（retained_earnings = 盈余公积 + 未分配利润；ebit = 利润总额 + 利息费用）允许，c=0.7。

## 注意
- 只返回 JSON 数组。
- field_key 在 k 中下划线小写。`;
};

PROMPTS.v1.user = (pdfText, pageCount, requestedFields) => {
  return `下方是 1 张财报扫描图片。横向并排 3 张表：左 资产负债表 | 中 利润表 | 右 现金流量表(忽略)。
请只通过看图提取数字。忽略现金流量表。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
};

// v2: 400 DPI + 小企业01表专用行标签（适配本报告）
PROMPTS.v2 = { ...PROMPTS.v1 };

PROMPTS.v2.system = (allKeys) => {
  const fieldList = allKeys.map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`).join("\n");
  return `你是中国小企业会计准则(小企业01表)下的财务数字 OCR 专家。从扫描件图片中提取以下白名单字段金额。

## 报表结构提示
该财报是"**小企业 01 表**"格式（横向并排 3 张表）：
- **左表 资产负债表**：行项目 | 行次 | 期末余额 | 年初余额；右半部是"负债和所有者权益"段
- **中表 利润表**：项目 | 行次 | 本年累计 | 上年累计
- **右表 现金流量表**（忽略）

## 字段白名单
${fieldList}

## ⚠️ 易混行项目（必须严格区分！这是高频错误点）
| 目标字段 | ✅ 找这一行（精确匹配行标签） | ❌ 不要找这些行 |
|---|---|---|
| current_assets | "**流动资产合计**" | "流动资产"（无合计）、"非流动资产合计"、子项（货币资金/应收账款/存货...） |
| current_liabilities | "**流动负债合计**" | "流动负债"（无合计）、子项（短期借款/应付账款/应付职工薪酬...）、"非流动负债合计" |
| total_assets | "**资产总计**" | "流动资产合计"（子集）、"非流动资产合计"、"负债和所有者权益总计"（这是大总计=资产总计） |
| total_liabilities | "**负债合计**" | "流动负债合计"（子集）、"非流动负债合计"、"**负债和所有者权益总计**"（大总计=资产总计） |
| equity_total | "**所有者权益合计**"或"股东权益合计" | "**负债和所有者权益总计**"（大总计=资产总计）、"实收资本"、"资本公积"、"盈余公积"、"未分配利润"等子项 |
| retained_earnings | "**留存收益**"或"保留盈余"；否则 = **盈余公积 + 未分配利润** | 任何单独子项 |
| revenue | "**营业收入**" | "营业总收入"（旧准则含利息）、"其他业务收入"、"营业外收入" |
| ebit | **小企业01表无"息税前利润"行**——用"**三、利润总额**"直接作为 EBIT 值。若报表有"息税前利润"行则优先用之 | "二、营业利润"（不是 EBIT）、"四、净利润" |

## 取哪一列
- 资产负债表类（流动/总资产/总负债/股东权益/留存）：取"**期末余额**"列（不是年初）
- 利润表类（营业收入/EBIT）：取"**本年累计**"列（不是上年累计）

## 输出格式（紧凑版，省 token）
返回 JSON 数组：
\`\`\`
[{"k":"current_assets","v":126604932.01,"ev":"流动资产合计","c":1.0},{"k":"current_liabilities","v":61738437.72,"ev":"流动负债合计","c":1.0},...]
\`\`\`
- k = field_key（下划线小写）
- v = 数字（无逗号无单位；保留全部位数+小数）
- ev = 行标签（≤8 字）
- c = confidence (1.0 直接命中 / 0.7 推算如 EBIT=利润总额)

## 数字铁律（最高优先级）
1. 100% 保留全部位数。原文 126,604,932.01 → 126604932.01。漏/多 0 即错。
2. 去千分位逗号，每段数字必保留。
3. 单位"元"；原文"万元"×10000；"亿元"×100000000。
4. 括号 (1,234.00) → -1234.00。
5. **强校验**：输出后逐条检查，v 是否可由 ev 对应行的数字原文（去逗号）直接得到。

## 找不到的字段
- v 必须为 null，不准猜。
- 推算值（retained_earnings = 盈余公积 + 未分配利润）允许，c=0.7。

## 注意
- 只返回 JSON 数组，无解释。`;
};

PROMPTS.v2.user = (pdfText, pageCount, requestedFields) => {
  return `下方是 1 张小企业01表格式的财报扫描图片。
表格布局：左 资产负债表（资产+负债+权益，期末/年初两列）| 中 利润表（项目+本年累计/上年累计）| 右 现金流量表（忽略）。
请通过看图严格按 system 中的行标签提取金额。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
};

// v3: 双图（资产负债表 + 利润表分别裁切）+ 显式 image 标签
PROMPTS.v3 = { ...PROMPTS.v2 };
PROMPTS.v3.crops = [
  {
    label: "资产负债表",
    x_pct: 0.02, y_pct: 0.10, w_pct: 0.36, h_pct: 0.85,
  },
  {
    label: "利润表",
    x_pct: 0.37, y_pct: 0.10, w_pct: 0.27, h_pct: 0.85,
  },
];

PROMPTS.v3.system = (allKeys) => {
  const fieldList = allKeys.map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`).join("\n");
  return `你是中国小企业会计准则(小企业01表)下的财务数字 OCR 专家。本任务提供了**两张独立裁切的图片**，请从对应图片中提取金额，不要混淆。

## 输入图片（按顺序）
- **图片 1：资产负债表**（左图）
  - 包含"资产"和"负债和所有者权益"两段
  - 每段列结构：行次 | 期末余额 | 年初余额
  - **必须取"期末余额"列**（即"年初余额"列的左侧那列）
- **图片 2：利润表**（中图）
  - 列结构：行次 | 本年累计 | 上年累计
  - **必须取"本年累计"列**

## 字段白名单（按图片分类）
- **来自图片 1（资产负债表）**：current_assets, current_liabilities, total_assets, total_liabilities, equity_total, retained_earnings
- **来自图片 2（利润表）**：revenue, ebit

## ⚠️ 易混行项目（必须严格区分！这是高频错误点）
| 目标字段 | ✅ 找这一行（精确匹配行标签） | ❌ 不要找这些行 |
|---|---|---|
| current_assets | "**流动资产合计**" | "流动资产"（无合计）、"非流动资产合计"、子项（货币资金/应收账款/存货...） |
| current_liabilities | "**流动负债合计**" | "流动负债"（无合计）、子项（短期借款/应付账款/应付职工薪酬...）、"非流动负债合计" |
| total_assets | "**资产总计**"（最后一行） | "流动资产合计"（子集）、"非流动资产合计"、"负债和所有者权益总计"（这是大总计=资产总计） |
| total_liabilities | "**负债合计**" | "流动负债合计"（子集）、"非流动负债合计"、"**负债和所有者权益总计**"（大总计=资产总计） |
| equity_total | "**所有者权益（或股东权益）合计**" | "**负债和所有者权益总计**"（大总计）、"实收资本（或股本）"、"资本公积" |
| retained_earnings | "**未分配利润**"（小企业 01 表无单独的"留存收益"行，直接用"未分配利润"） | "盈余公积"（是另一项权益） |
| revenue | "**一、营业收入**"（利润表第 1 行） | "营业总收入"（旧准则）、"其他业务收入"、"营业外收入" |
| ebit | **小企业01表无"息税前利润"行**——直接用"**三、利润总额**" | "二、营业利润"、"四、净利润" |

## 输出格式（紧凑版）
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
- 只返回 JSON 数组。`;
};

PROMPTS.v3.user = (pdfText, pageCount, requestedFields) => {
  return `下方附了 2 张独立裁切的图片：
- **图片 1：资产负债表**（小企业01表，资产+负债+权益，期末/年初两列）
- **图片 2：利润表**（小企业01表，项目+本年累计/上年累计）

请分别从对应图片中提取白名单字段的金额（按 system 指引）。
资产负债表字段取"**期末余额**"列（不是"年初余额"）。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
};

// v4: 2 个独立 API call（BS 一次 / IS 一次），各自 max DPI + 各自聚焦 prompt
PROMPTS.v4_bs = {
  split: true, // 标记：触发主函数分两次调用
  only: "bs",
  crops: [
    {
      label: "资产负债表",
      x_pct: 0.02, y_pct: 0.10, w_pct: 0.36, h_pct: 0.85,
    },
  ],
  fieldList: ["current_assets", "current_liabilities", "total_assets", "total_liabilities", "equity_total", "retained_earnings"],
  system: (allKeys) => {
    const fieldList = allKeys.map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`).join("\n");
    return `你是中国小企业会计准则下的财务 OCR 专家。任务：**只从下方 1 张资产负债表中**提取以下字段金额（仅此一项任务，不处理其他报表）。

## 资产负债表结构
- 列结构：**行次 | 期末余额 | 年初余额**
- **必须取"期末余额"列**（即"年初余额"列的**左侧**那列；不要取"年初余额"）
- 包含两段：左半"资产"段 + 右半"负债和所有者权益"段

## 字段白名单（仅以下 6 项）
${fieldList}

## ⚠️ 易混行项目（必须严格区分！这是高频错误点）
| 目标字段 | ✅ 找这一行（精确匹配行标签） | ❌ 不要找这些行 |
|---|---|---|
| current_assets | "**流动资产合计**" | "流动资产"（无合计）、"非流动资产合计"、子项（货币资金/应收账款/存货/其他应收款/预付款项...） |
| current_liabilities | "**流动负债合计**" | "流动负债"（无合计）、子项（短期借款/应付账款/应付职工薪酬/应交税费/其他应付款...）、"非流动负债合计" |
| total_assets | "**资产总计**"（最后一行） | "流动资产合计"（子集）、"非流动资产合计"、"负债和所有者权益总计"（大总计） |
| total_liabilities | "**负债合计**" | "流动负债合计"（子集）、"非流动负债合计"、"**负债和所有者权益总计**"（大总计=资产总计） |
| equity_total | "**所有者权益（或股东权益）合计**" | "**负债和所有者权益总计**"（大总计=资产总计）、"实收资本（或股本）"、"资本公积"、"盈余公积"、"未分配利润"等子项 |
| retained_earnings | 小企业 01 表无"留存收益"行——直接用"**未分配利润**" | "盈余公积"（是另一项权益，不是留存收益） |

## 输出格式（紧凑版）
返回 JSON 数组：
\`\`\`
[{"k":"current_assets","v":126604932.01,"ev":"流动资产合计","c":1.0},...]
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
v 必须为 null，不准猜。

## 注意
- 只返回 JSON 数组。
- **绝对不要从其他列读数字**——只读"期末余额"列。`;
  },
  user: (pdfText, pageCount) => {
    return `下方是 1 张资产负债表的扫描图片（小企业01表，资产+负债+权益，期末/年初两列）。
请严格按 system 中的行标签从"**期末余额**"列提取金额。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
  },
};

PROMPTS.v4_is = {
  split: true,
  only: "is",
  crops: [
    {
      label: "利润表",
      x_pct: 0.37, y_pct: 0.10, w_pct: 0.27, h_pct: 0.85,
    },
  ],
  fieldList: ["revenue", "ebit"],
  system: (allKeys) => {
    const fieldList = allKeys.map((k) => `  - "${k}" (${FIELD_LABELS[k] ?? k})`).join("\n");
    return `你是中国小企业会计准则下的财务 OCR 专家。任务：**只从下方 1 张利润表中**提取以下字段金额（仅此一项任务，不处理其他报表）。

## 利润表结构
- 列结构：**行次 | 本年累计 | 上年累计**
- **必须取"本年累计"列**（即"上年累计"列的**左侧**那列）
- 这是"小企业 02 表"格式

## 字段白名单（仅以下 2 项）
${fieldList}

## 字段识别
- **revenue** = "**一、营业收入**"（第 1 行）。不要找"营业总收入"（旧准则）、"其他业务收入"、"营业外收入"。
- **ebit** = **小企业 02 表无"息税前利润"行**——直接用"**三、利润总额**"（第 30 行）。
  - 验证：利润总额 ≈ 二、营业利润 + 加：营业外收入 - 减：营业外支出 = 9,140,275.75 + 459,265.52 - 165,884.32 = 9,433,656.95
  - **不要混淆为"二、营业利润"**（第 21 行 9,140,275.75）或"四、净利润"（第 32 行）

## 输出格式（紧凑版）
返回 JSON 数组：
\`\`\`
[{"k":"revenue","v":147087809.03,"ev":"一、营业收入","c":1.0},{"k":"ebit","v":9433656.95,"ev":"三、利润总额","c":1.0}]
\`\`\`
- k = field_key
- v = 数字（无逗号无单位；保留全部位数+小数）
- ev = 行标签（≤8 字）
- c = confidence (1.0 直接命中)

## 数字铁律
1. 100% 保留全部位数。漏/多 0 即错。
2. 去千分位逗号，每段数字必保留。
3. 单位"元"。
4. 强校验：v 是否可由 ev 对应行的数字原文（去逗号）直接得到。

## 注意
- 只返回 JSON 数组。
- **绝对不要从其他列读数字**——只读"本年累计"列。`;
  },
  user: (pdfText, pageCount) => {
    return `下方是 1 张利润表的扫描图片（小企业02表，项目+本年累计/上年累计）。
请严格按 system 中的行标签从"**本年累计**"列提取金额。
返回紧凑 JSON 数组 [k, v, ev, c]。`;
  },
};

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════
const pdfPath = process.argv[2];
const version = process.argv[3] || "v0";
const dpi = parseInt(process.argv[4] || "200", 10);
const maxTokens = parseInt(process.argv[5] || "1024", 10);

if (!pdfPath) {
  console.error("用法: node test-ai-extract.mjs <pdf路径> [prompt版本 v0-v3|v4] [dpi] [maxTokens]");
  process.exit(1);
}

if (!PROMPTS[version] && version !== "v4") {
  console.error(`Unknown prompt version: ${version}. Available: ${Object.keys(PROMPTS).join(", ")}, v4`);
  process.exit(1);
}

console.log(`\n=== TEST HARNESS ===`);
console.log(`PDF:      ${pdfPath}`);
console.log(`Version:  ${version}`);
console.log(`DPI:      ${dpi}`);
console.log(`Max tok:  ${maxTokens}`);

// v4 = 合并运行 v4_bs + v4_is
if (version === "v4") {
  const merge = (parsedArr) =>
    parsedArr
      .map((x) => {
        const k = x.k || x.field_key;
        const v = x.v ?? x.value;
        const ev = x.ev ?? x.evidence ?? "";
        const c = x.c ?? x.confidence;
        return { k, v, ev, c };
      });

  const allParsed = [];
  for (const sub of ["v4_bs", "v4_is"]) {
    const p = PROMPTS[sub];
    console.log(`\n──── ${sub} ────`);
    const system = p.system(p.fieldList);
    const user = p.user("", p.crops.length);
    console.log(`\n[1/3] Rendering crops (${p.crops.length} regions)...`);
    const t0 = Date.now();
    const crops = await pdfToCropsBase64(pdfPath, dpi, p.crops);
    const images = crops.map((c) => c.base64);
    const totalMB = images.reduce((s, i) => s + i.length, 0) / 1024 / 1024;
    console.log(`      Crops: ${crops.map((c) => c.label).join(" + ")}`);
    console.log(`      Total ${images.length} image(s), ${totalMB.toFixed(2)} MB in ${Date.now() - t0} ms`);

    console.log(`\n[2/3] Calling API...`);
    const t1 = Date.now();
    const r = await callApi(images, system, user, { max_tokens: maxTokens });
    console.log(`      HTTP ${r.status} in ${Date.now() - t1} ms`);
    if (r.status >= 400) {
      console.log(`\n⚠️  HTTP ERROR BODY:\n${r.raw?.slice(0, 800)}`);
    }

    console.log(`\n[3/3] Parsing...`);
    console.log(`\n─── RAW (${r.content.length} chars) ───`);
    console.log(r.content || "(empty)");
    console.log("─── END ───\n");

    const parsed = parseResult(r.content);
    if (parsed) {
      allParsed.push(...merge(parsed));
    }
  }

  // 合并后用 ALL_KEYS 比较
  const results = compare(allParsed);
  renderTable(results);

  const exact = results.filter((r) => r.status === "✅").length;
  const close = results.filter((r) => r.status === "🟡近").length;
  const wrong = results.filter((r) => r.status === "❌").length;
  const empty = results.filter((r) => r.status === "⏳空").length;
  console.log(`\n📊 统计: ✅ ${exact}  🟡 ${close}  ❌ ${wrong}  ⏳ ${empty}  (共 ${ALL_KEYS})`);

  console.log(`\n─── EVIDENCE 详单 ───`);
  for (const r of results) {
    console.log(`${r.status} [${r.field}] ${r.label}`);
    console.log(`   evidence: ${r.evidence}`);
  }
  process.exit(0);
}

const p = PROMPTS[version];
const system = p.system(ALL_KEYS);
const user = p.user("", p.crops ? p.crops.length : 1, ALL_KEYS);

let images;
let cropInfo = "(full page)";
if (p.crops && p.crops.length > 0) {
  console.log(`\n[1/3] Rendering PDF to crops (${p.crops.length} regions)...`);
  const t0 = Date.now();
  const crops = await pdfToCropsBase64(pdfPath, dpi, p.crops);
  images = crops.map((c) => c.base64);
  cropInfo = crops.map((c) => c.label).join(" + ");
  const totalMB = images.reduce((s, i) => s + i.length, 0) / 1024 / 1024;
  console.log(`      Crops: ${cropInfo}`);
  console.log(`      Total ${images.length} image(s), ${totalMB.toFixed(2)} MB in ${Date.now() - t0} ms`);
} else {
  console.log(`\n[1/3] Rendering PDF to PNG (full page)...`);
  const t0 = Date.now();
  images = pdfToBase64Png(pdfPath, dpi);
  const totalMB = images.reduce((s, i) => s + i.length, 0) / 1024 / 1024;
  console.log(`      Got ${images.length} image(s), total ${totalMB.toFixed(2)} MB in ${Date.now() - t0} ms`);
}

console.log(`\n[2/3] Calling API (${cfg.vision_model})...`);
const t1 = Date.now();
const r = await callApi(images, system, user, { max_tokens: maxTokens });
const latency = Date.now() - t1;
console.log(`      HTTP ${r.status} in ${latency} ms`);
if (r.status >= 400) {
  console.log(`\n⚠️  HTTP ERROR BODY:\n${r.raw?.slice(0, 800)}`);
}

console.log(`\n[3/3] Parsing...`);
console.log(`\n─── RAW RESPONSE (${r.content.length} chars) ───`);
console.log(r.content || "(empty)");
console.log("─── END ───\n");

const parsed = parseResult(r.content);
if (!parsed) {
  console.log("❌ Failed to parse JSON array from response");
  process.exit(1);
}

const results = compare(parsed);
renderTable(results);

const exact = results.filter((r) => r.status === "✅").length;
const close = results.filter((r) => r.status === "🟡近").length;
const wrong = results.filter((r) => r.status === "❌").length;
const empty = results.filter((r) => r.status === "⏳空").length;
console.log(`\n📊 统计: ✅ ${exact}  🟡 ${close}  ❌ ${wrong}  ⏳ ${empty}  (共 ${ALL_KEYS})`);

// 写一个 evidence dump 便于诊断
console.log(`\n─── EVIDENCE 详单 ───`);
for (const r of results) {
  console.log(`${r.status} [${r.field}] ${r.label}`);
  console.log(`   evidence: ${r.evidence}`);
}
