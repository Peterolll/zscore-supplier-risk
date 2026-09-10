// lib/ai-client.ts — 通用 AI 客户端（OpenAI-compatible）
//
// 支持任意 OpenAI-compatible API：智谱 GLM / OpenAI GPT / Deepseek / Moonshot / 自定义端点
// 统一调用 /chat/completions 接口，Bearer token 鉴权
//
// 两种调用模式：
//   - Unified: 单次调用 + 全文+全图 → 适合一般电子 PDF
//   - Split: 拆 BS/IS 两个独立 call（各自聚焦 prompt + 各自裁切）→ 适合扫描件 PDF
//            在 Lenovo DT 测试中准确率从 7/8 提升到 8/8（详见 docs/AI_ASSIST_PRD.md）

import path from "node:path";
import fs from "node:fs";
import { getAiConfig } from "./ai-config";
import {
  buildUnifiedSystemPrompt,
  buildUnifiedUserPrompt,
  buildBsSystemPrompt,
  buildBsUserPrompt,
  buildIsSystemPrompt,
  buildIsUserPrompt,
  BS_FIELDS,
  IS_FIELDS,
  BS_CROP,
  IS_CROP,
} from "./ai-prompts";

/** Z-Score 系统需要的字段（完整白名单，10 项） */
export const FIELD_KEYS = [
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

export const FIELD_LABELS: Record<string, string> = {
  current_assets: "流动资产合计",
  current_liabilities: "流动负债合计",
  total_assets: "资产总计",
  total_liabilities: "负债合计",
  equity_total: "所有者权益合计",
  retained_earnings: "留存收益（盈余公积+未分配利润）",
  revenue: "营业收入",
  ebit: "息税前利润（利润总额+利息费用）",
  profit_before_tax: "利润总额（税前利润）",
  interest_expense: "利息费用",
};

export interface AiFieldSuggestion {
  field_key: string;
  field_label: string;
  value: number | null;
  confidence: number; // 0-1
  evidence: string; // 原文摘要 / 推理过程
  method: "ai_ocr" | "ai_analyze" | "ai_derived";
  warning?: string; // 量级与原文不符等风险提示
}

export interface AiAnalyzeResult {
  ok: boolean;
  suggestions: AiFieldSuggestion[];
  raw_text?: string;
  error?: string;
  model_used?: string;
  /** 版面策略：landscape-crop=横向百分比裁切；portrait-page=纵向整页定位 */
  layout?: "landscape-crop" | "portrait-page";
  /** portrait-page 时实际使用的页码（1-based） */
  pages?: { bsPage: number; isPage: number };
}

/** 构建完整的 chat/completions URL */
function buildChatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v4") || base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/**
 * 单次多模态调用（Unified 模式）：同时传入 PDF 文本 + 全部页面图片，
 * 由多模态模型（如 GLM-4V）自行判断使用文本还是图片提取数字。
 *
 * 关键点（保证 per-field 与整体结果一致）：
 *   - 始终传入全部字段白名单作为上下文（allFieldKeys）
 *   - 仅用 requestedFields 标注"重点请求"，不改变模型看到的上下文
 *   - 因此同一字段无论单独请求还是整体请求，模型看到的 context 完全一致 → 结果一致
 */
export async function callMultimodalModel(
  pdfText: string,
  imagesBase64: string[],
  allFieldKeys: string[],
  requestedFields?: string[]
): Promise<AiAnalyzeResult> {
  const cfg = getAiConfig();
  if (!cfg.api_key) return { ok: false, suggestions: [], error: "NO_API_KEY" };

  const useVision = !!cfg.vision_model?.trim();
  const model = useVision ? cfg.vision_model!.trim() : (cfg.text_model?.trim() || "");
  if (!model) {
    return {
      ok: false,
      suggestions: [],
      error: "NO_MODEL（请在设置页填写视觉模型名或文本模型名，如 GLM-4V-Flash）",
    };
  }

  const url = buildChatUrl(cfg.base_url);
  const systemPrompt = buildUnifiedSystemPrompt(allFieldKeys, requestedFields);
  const userPrompt = buildUnifiedUserPrompt(pdfText, imagesBase64.length, requestedFields);

  const userContent: any[] = [{ type: "text", text: userPrompt }];
  if (useVision) {
    for (const img of imagesBase64) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${img}` },
      });
    }
  }

  return _doChat(url, model, systemPrompt, userContent, useVision ? "ai_ocr" : "ai_analyze", allFieldKeys);
}

// ════════════════════════════════════════════════════════════════════
// Split 模式：BS / IS 独立 call
// ════════════════════════════════════════════════════════════════════

/**
 * Split 模式专用：调用一次 API（针对 BS 或 IS 单张图）
 * @param systemPrompt 已构建好的 system prompt
 * @param userPrompt   已构建好的 user prompt
 * @param imageB64     单张图（BS 或 IS 裁切图）
 * @param fields       白名单字段（用于 JSON parser 过滤）
 * @param method       ai_ocr / ai_analyze
 */
async function _doSingleImageCall(
  systemPrompt: string,
  userPrompt: string,
  imageB64: string,
  fields: string[],
  method: "ai_ocr" | "ai_analyze"
): Promise<AiAnalyzeResult> {
  const cfg = getAiConfig();
  const model = cfg.vision_model?.trim() || cfg.text_model?.trim() || "";
  if (!model) {
    return {
      ok: false,
      suggestions: [],
      error: "NO_MODEL（请在设置页填写视觉模型名或文本模型名，如 GLM-4V-Flash）",
    };
  }
  const url = buildChatUrl(cfg.base_url);
  const userContent: any[] = [
    { type: "text", text: userPrompt },
    { type: "image_url", image_url: { url: `data:image/png;base64,${imageB64}` } },
  ];
  return _doChat(url, model, systemPrompt, userContent, method, fields);
}

/**
 * Split 模式：BS 独立 call
 */
export async function callMultimodalBs(
  imageB64: string,
  requestedFields?: string[]
): Promise<AiAnalyzeResult> {
  const cfg = getAiConfig();
  if (!cfg.api_key) return { ok: false, suggestions: [], error: "NO_API_KEY" };

  const systemPrompt = buildBsSystemPrompt(requestedFields);
  const userPrompt = buildBsUserPrompt();
  // 默认白名单与 BS_FIELDS 保持同源，避免两处硬编码漂移
  const fields =
    requestedFields && requestedFields.length > 0
      ? requestedFields
      : [...BS_FIELDS];

  return _doSingleImageCall(systemPrompt, userPrompt, imageB64, fields, "ai_ocr");
}

/**
 * Split 模式：IS 独立 call
 */
export async function callMultimodalIs(
  imageB64: string,
  requestedFields?: string[]
): Promise<AiAnalyzeResult> {
  const cfg = getAiConfig();
  if (!cfg.api_key) return { ok: false, suggestions: [], error: "NO_API_KEY" };

  const systemPrompt = buildIsSystemPrompt(requestedFields);
  const userPrompt = buildIsUserPrompt();
  // ⚠️ 修复：原默认白名单仅 ["revenue","ebit"]，漏掉 profit_before_tax / interest_expense，
  //    导致"税前利润"永远无法被 AI 补全（模型还被误导把利润总额填进 ebit）。
  //    现在与 IS_FIELDS 同源，四个 IS 字段都可被接受。
  const fields =
    requestedFields && requestedFields.length > 0
      ? requestedFields
      : [...IS_FIELDS];

  return _doSingleImageCall(systemPrompt, userPrompt, imageB64, fields, "ai_ocr");
}

/**
 * 通用 chat 调用 + 解析
 */
async function _doChat(
  url: string,
  model: string,
  systemPrompt: string,
  userContent: any[],
  defaultMethod: "ai_ocr" | "ai_analyze",
  allowedFields: string[]
): Promise<AiAnalyzeResult> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: authHeaders(getAiConfig().api_key),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return {
        ok: false,
        suggestions: [],
        error: `MULTIMODAL_API_${resp.status}: ${txt.slice(0, 200)}`,
        model_used: model,
      };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return parseAiResponse(content, defaultMethod, model, allowedFields);
  } catch (e: any) {
    return {
      ok: false,
      suggestions: [],
      error: `MULTIMODAL_FETCH: ${e?.message || String(e)}`,
      model_used: model,
    };
  }
}

/**
 * API 连通性测试：发送最小请求验证 key 是否有效。
 */
export async function testApiConnection(
  baseUrl: string,
  apiKey: string,
  model: string
): Promise<{
  ok: boolean;
  latency_ms?: number;
  model_response?: string;
  error?: string;
}> {
  const url = buildChatUrl(baseUrl);
  const start = Date.now();

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "请回复OK两个字。" },
          { role: "user", content: "测试连接" },
        ],
        temperature: 0,
        max_tokens: 16,
      }),
    });

    const latency_ms = Date.now() - start;

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      let error = `HTTP ${resp.status}`;
      try {
        const j = JSON.parse(txt);
        error = j?.error?.message || j?.error?.code || error;
      } catch {
        if (txt) error = `${error}: ${txt.slice(0, 150)}`;
      }
      return { ok: false, latency_ms, error };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return {
      ok: true,
      latency_ms,
      model_response: typeof content === "string" ? content.slice(0, 100) : String(content).slice(0, 100),
    };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: `FETCH_ERROR: ${e?.message || String(e)}` };
  }
}

/**
 * 从 evidence 文本中提取所有数字（归一化：去逗号）。
 */
function extractAllNumbers(text: string): number[] {
  const matches = text.match(/[\d,]{4,}(?:\.\d+)?/g);
  if (!matches) return [];
  const nums: number[] = [];
  for (const m of matches) {
    const n = parseFloat(m.replace(/,/g, ""));
    if (isFinite(n)) nums.push(n);
  }
  return nums;
}

/**
 * 解析 AI 返回的 JSON 数组
 *   - 兼容 ```json 包裹与裸 JSON
 *   - 兼容长键 (field_key) 与紧凑键 (k)
 *   - 字符串数字自动转数值
 *   - 服务端 evidence 交叉校验（value 与 evidence 数字不一致 → confidence 降级 + warning）
 */
function parseAiResponse(
  content: string,
  defaultMethod: "ai_ocr" | "ai_analyze",
  model: string,
  allowedFields: string[] = [...FIELD_KEYS]
): AiAnalyzeResult {
  let raw = content.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) raw = fence[1].trim();

  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrMatch) {
    return { ok: false, suggestions: [], raw_text: content, error: "PARSE_NO_ARRAY", model_used: model };
  }

  try {
    const parsed = JSON.parse(arrMatch[0]) as any[];
    const allowed = new Set<string>(allowedFields);

    const suggestions: AiFieldSuggestion[] = parsed
      .filter((x) => {
        const k = x.field_key || x.k;
        return x && typeof k === "string" && allowed.has(k);
      })
      .map((x) => {
        const fieldKey = x.field_key || x.k;
        // 兼容字符串数字（带千分位逗号）
        let numVal: number | null = null;
        const rawVal = x.value ?? x.v;
        if (typeof rawVal === "number") {
          numVal = rawVal;
        } else if (typeof rawVal === "string") {
          const cleaned = rawVal.replace(/,/g, "").trim();
          const n = parseFloat(cleaned);
          numVal = isFinite(n) ? n : null;
        }

        const sug: AiFieldSuggestion = {
          field_key: fieldKey,
          field_label: FIELD_LABELS[fieldKey] ?? fieldKey,
          value: numVal,
          confidence: typeof (x.confidence ?? x.c) === "number" ? (x.confidence ?? x.c) : 0.7,
          evidence: typeof (x.evidence ?? x.ev) === "string" ? (x.evidence ?? x.ev) : "",
          method: defaultMethod,
        };

        // 交叉核验：value 与 evidence 原文数字一致性
        if (sug.value != null && sug.evidence && sug.method !== "ai_derived") {
          const evNums = extractAllNumbers(sug.evidence);
          if (evNums.length > 0) {
            const exact = evNums.some((n) => Math.abs(n - sug.value!) < 0.01);
            if (!exact) {
              sug.warning = "提取数值与原文该科目数字不一致（可能错位/颠倒/漏 0），请人工核对后再采纳";
              sug.confidence = Math.min(sug.confidence, 0.3);
            }
          }
        }
        return sug;
      });
    return { ok: true, suggestions, raw_text: content, model_used: model };
  } catch (e: any) {
    return { ok: false, suggestions: [], raw_text: content, error: `PARSE_JSON: ${e?.message}`, model_used: model };
  }
}

// ════════════════════════════════════════════════════════════════════
// PDF 渲染辅助
// ════════════════════════════════════════════════════════════════════

/**
 * 将 PDF 整页转为 PNG base64（使用 pdftoppm，无裁切）。
 * 安全：使用 execFileSync + 数组参数。
 */
export async function pdfToImagesBase64(
  pdfPath: string,
  maxPages: number = 5
): Promise<string[]> {
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zscore-ai-"));
  const prefix = path.join(tmpDir, "page");

  try {
    execFileSync(
      "pdftoppm",
      ["-png", "-r", "150", "-l", String(maxPages), pdfPath, prefix],
      { timeout: 60000, stdio: "pipe" }
    );

    const files = (await fsp.readdir(tmpDir))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .slice(0, maxPages);

    const images: string[] = [];
    for (const f of files) {
      const buf = await fsp.readFile(path.join(tmpDir, f));
      images.push(buf.toString("base64"));
    }
    return images;
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Split 模式专用：将 PDF 页面裁切为 BS / IS 区域，转为 PNG base64。
 * 裁切坐标基于 72 DPI（pdftoppm 的 -x/-y/-W/-H 默认坐标）。
 *
 * @param pdfPath PDF 路径
 * @param crop    { x_pct, y_pct, w_pct, h_pct } 比例 0..1；传 FULL_PAGE 表示整页不裁
 * @param dpi     输出分辨率（默认 400）
 * @param page    页码（1-based，默认 1）
 */
export async function pdfToCroppedBase64(
  pdfPath: string,
  crop: { x_pct: number; y_pct: number; w_pct: number; h_pct: number },
  dpi: number = 400,
  page: number = 1
): Promise<string | null> {
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const fsp = await import("node:fs/promises");

  // 1) 获取页面尺寸（72 DPI 像素）
  let pageW = 960;
  let pageH = 540;
  try {
    const pdfinfo = execFileSync("pdfinfo", [pdfPath], { encoding: "utf-8", timeout: 10000 });
    const m = pdfinfo.match(/Page size:\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
    if (m) {
      pageW = Math.round(parseFloat(m[1]));
      pageH = Math.round(parseFloat(m[2]));
    }
  } catch {
    // 拿不到尺寸则假设标准 960×540
  }

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "zscore-ai-crop-"));
  const prefix = path.join(tmpDir, "p");

  // 2) 裁切坐标（输出像素）
  //
  // ⚠️ 关键修复（2026-09-03）：pdftoppm 的 -x/-y/-W/-H 在带 -r 时是**输出像素**，
  // 不是 72 DPI 点。原实现按 pageW/pageH（pdfinfo 报的"页大小"=点）直接算坐标，
  // 同一份调用里既被解释成"小区域的点"、又被 pdftoppm 当"大区域的像素"——
  // FULL_PAGE {0,0,1,1} 实际只输出 pageW×pageH 像素的图像（A4 = 595×842），
  // 相当于整页的左上 ~36%×36%，下方正文全部丢失。
  // 实测：测试5 利润表页被截到只剩"标题+营业收入/营业成本/税金及附加"4 行，
  // "三、利润总额" 行根本不在画面内 → AI 只能返回 null 并附 ev="三、利润总额"（凭推断）。
  //
  // 正确做法：pageW/pageH（点）先 × dpi/72 换算到输出像素，再乘以百分比。
  const pxW = Math.round((pageW * dpi) / 72);
  const pxH = Math.round((pageH * dpi) / 72);
  const x = Math.max(0, Math.round(crop.x_pct * pxW));
  const y = Math.max(0, Math.round(crop.y_pct * pxH));
  const w = Math.max(1, Math.round(crop.w_pct * pxW));
  const h = Math.max(1, Math.round(crop.h_pct * pxH));

  try {
    // pdftoppm 裁切（-x/-y/-W/-H 在 72 DPI 坐标）
    execFileSync(
      "pdftoppm",
      [
        "-png",
        "-r", String(dpi),
        "-x", String(x),
        "-y", String(y),
        "-W", String(w),
        "-H", String(h),
        "-f", String(page), // 起始页
        "-l", String(page), // 结束页（只取指定页）
        pdfPath,
        prefix,
      ],
      { timeout: 60000, stdio: "pipe" }
    );

    const files = (await fsp.readdir(tmpDir))
      .filter((f) => f.endsWith(".png"))
      .sort();
    if (files.length === 0) return null;

    const buf = await fsp.readFile(path.join(tmpDir, files[0]));
    return buf.toString("base64");
  } catch {
    return null;
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 整页不裁（用于"纵向整页一张表"的版面） */
export const FULL_PAGE = { x_pct: 0, y_pct: 0, w_pct: 1, h_pct: 1 };

/** PDF 版面元信息 */
export interface PdfMeta {
  pageCount: number;
  pageW: number;
  pageH: number;
}

/** 读取 PDF 页数与页面尺寸（72 DPI 点）。失败时回退到 960×540 / 1 页。 */
export async function getPdfMeta(pdfPath: string): Promise<PdfMeta> {
  const fallback: PdfMeta = { pageCount: 1, pageW: 960, pageH: 540 };
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("pdfinfo", [pdfPath], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pc = out.match(/Pages:\s+(\d+)/);
    const ps = out.match(/Page size:\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
    return {
      pageCount: pc ? Math.max(1, parseInt(pc[1], 10)) : 1,
      pageW: ps ? Math.round(parseFloat(ps[1])) : fallback.pageW,
      pageH: ps ? Math.round(parseFloat(ps[2])) : fallback.pageH,
    };
  } catch {
    return fallback;
  }
}

export type StatementKind = "BS" | "IS" | "CF" | "OTHER";

/**
 * 单页版面分类：这一页是资产负债表 / 利润表 / 现金流量表 / 其他？
 * 用 72 DPI 小图 + 极短输出，成本很低（≈1 次小请求）。失败返回 null。
 */
export async function classifyStatementPage(
  pdfPath: string,
  page: number
): Promise<StatementKind | null> {
  const cfg = getAiConfig();
  if (!cfg.api_key) return null;
  const model = cfg.vision_model?.trim() || cfg.text_model?.trim() || "";
  if (!model) return null;

  let b64: string | null = null;
  try {
    b64 = await pdfToCroppedBase64(pdfPath, FULL_PAGE, 72, page);
  } catch {
    return null;
  }
  if (!b64) return null;

  try {
    const resp = await fetch(buildChatUrl(cfg.base_url), {
      method: "POST",
      headers: authHeaders(cfg.api_key),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是财报版面识别器。只回复一个字母：A=资产负债表，B=利润表/损益表，C=现金流量表，D=其他（封面/目录/附注/审计意见/所有者权益变动表）。不要输出任何其他文字。",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "这一页属于哪一类？只回复 A / B / C / D 中的一个字母。" },
              { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 8,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const t = String(data?.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
    if (t.startsWith("A")) return "BS";
    if (t.startsWith("B")) return "IS";
    if (t.startsWith("C")) return "CF";
    if (t.startsWith("D")) return "OTHER";
    return null;
  } catch {
    return null;
  }
}

/**
 * 定位资产负债表 / 利润表各自所在的页码。
 *
 * 背景（2026-09-03 修复）：原实现**永远只裁第 1 页**，且按"横向 960×540、三表并排"
 * 的百分比坐标裁切。遇到 A4 纵向、每页一张表、共 2 页的财报时会彻底错位——
 * 利润表裁到的是第 1 页（实为资产负债表）的中间竖条，于是营业收入/利润总额/税前利润
 * 全部返回 null。这正是"AI 识别也识别不到税前利润"的直接原因。
 *
 * 策略：
 *   1. 先用《企业会计准则》的列报顺序（资产负债表 → 利润表）作为先验：{bsPage:1, isPage:2}
 *   2. 再用逐页小图分类修正（覆盖"第 1 页是封面"等情形）
 *   3. 分类失败则保留先验，绝不因此中断
 */
export async function detectStatementPages(
  pdfPath: string,
  meta: PdfMeta
): Promise<{ bsPage: number; isPage: number; viaClassifier: boolean }> {
  let bsPage = 1;
  let isPage = Math.min(2, meta.pageCount);
  let viaClassifier = false;

  const maxScan = Math.min(meta.pageCount, 8); // 主表一般靠前，超过 8 页不再扫
  let foundBs: number | null = null;
  let foundIs: number | null = null;

  for (let p = 1; p <= maxScan; p++) {
    if (foundBs && foundIs) break;
    const kind = await classifyStatementPage(pdfPath, p);
    if (!kind) continue;
    if (kind === "BS" && !foundBs) foundBs = p;
    if (kind === "IS" && !foundIs) foundIs = p;
  }

  if (foundBs) {
    bsPage = foundBs;
    viaClassifier = true;
  }
  if (foundIs) {
    isPage = foundIs;
    viaClassifier = true;
  }
  // 若两页撞车（同一页既判 BS 又判 IS），退回先验
  if (bsPage === isPage && meta.pageCount >= 2) {
    bsPage = 1;
    isPage = 2;
    viaClassifier = false;
  }
  return { bsPage, isPage, viaClassifier };
}

/**
 * 从电子 PDF 提取全文本（用 pdftotext）。
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  try {
    const txt = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      timeout: 30000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 2,
    });
    return txt || "";
  } catch {
    return "";
  }
}

// ════════════════════════════════════════════════════════════════════
// Split 模式：组合入口
// ════════════════════════════════════════════════════════════════════

/**
 * Split 模式：拆 BS / IS 独立 call，合并结果
 * @param pdfPath        PDF 路径
 * @param requestedFields 需要补全的字段（空数组=全部）
 * @returns              合并后的 suggestions（BS + IS 一并）
 */
export async function callMultimodalSplitModel(
  pdfPath: string,
  requestedFields?: string[]
): Promise<AiAnalyzeResult> {
  const allFields = requestedFields && requestedFields.length > 0 ? requestedFields : [...FIELD_KEYS];
  // 拆分请求字段
  // 与 prompt 模板同源，杜绝此处再硬编码一份字段列表
  const BS_KEYS: string[] = [...BS_FIELDS];
  const IS_KEYS: string[] = [...IS_FIELDS];
  const bsNeeded = allFields.filter((f) => BS_KEYS.includes(f));
  const isNeeded = allFields.filter((f) => IS_KEYS.includes(f));

  // 【关键修复】只要某张表需要任意 1 个字段，就把该表的**全部**字段交给该次 call。
  // 反例（旧行为）：只缺 ebit 时，isNeeded=["ebit"]，prompt 白名单里只剩 ebit，
  //   模型被"ebit 无独立行项目"规则卡住 → 要么把利润总额塞进 ebit，要么返回 null，
  //   而真正的 profit_before_tax 根本没被问到，于是"税前利润识别不到"。
  // 现在固定下发整表字段：单次 call 成本不变，但模型能一并看到 利润总额/利息费用/营业收入
  //   做勾稽自检，准确率更高；多余字段由调用方按 requestedFields 过滤。
  const bsRequest = bsNeeded.length > 0 ? [...BS_KEYS] : [];
  const isRequest = isNeeded.length > 0 ? [...IS_KEYS] : [];

  // 1) 版面自适应：决定 BS / IS 各自取哪一页、整页还是百分比裁切
  //
  //  旧行为：永远裁第 1 页 + 横向三表并排的固定百分比坐标。
  //  对"横向 960×540 三表并排"的财报（如 Lenovo DT 样本）有效，
  //  但对 A4 纵向 / 每页一张表 / 多页的财报会彻底错位：
  //  利润表明明在第 2 页，却被裁到第 1 页（资产负债表）的中间竖条。
  //
  //  新逻辑：
  //   - 横向 或 单页  → 沿用已验证有效的百分比裁切（BS_CROP / IS_CROP，第 1 页）
  //   - 纵向 且 多页 → 先定位 BS/IS 页码，再整页渲染（DPI 300，与 Python OCR 通道一致）
  const meta = await getPdfMeta(pdfPath);
  const isPortraitMultiPage = meta.pageCount >= 2 && meta.pageH > meta.pageW;

  let layout: "landscape-crop" | "portrait-page" = "landscape-crop";
  let bsPage = 1;
  let isPage = 1;

  let bsImg: string | null = null;
  let isImg: string | null = null;

  if (isPortraitMultiPage) {
    layout = "portrait-page";
    const { bsPage: bp, isPage: ip } = await detectStatementPages(pdfPath, meta);
    bsPage = bp;
    isPage = ip;
    // DPI 200（不是 300）：A4 整页在 DPI 300 下是 2480×3508 ≈ 8.7MP，
    // 实测经代理网关转发后会被降采样、小字号数字糊掉，模型"认得出科目行却读不出金额"
    // （典型症状：返回 {"k":"profit_before_tax","v":null,"ev":"三、利润总额"}）。
    // DPI 200 → 1654×2339 ≈ 3.9MP，清晰度与体积平衡；unified 模式的 DPI 150 亦可正常识别。
    [bsImg, isImg] = await Promise.all([
      bsNeeded.length > 0
        ? pdfToCroppedBase64(pdfPath, FULL_PAGE, 200, bsPage)
        : Promise.resolve(null),
      isNeeded.length > 0
        ? pdfToCroppedBase64(pdfPath, FULL_PAGE, 200, isPage)
        : Promise.resolve(null),
    ]);
    // 整页渲染若失败，退回百分比裁切，保证不比旧版更差
    if ((!bsImg && bsNeeded.length > 0) || (!isImg && isNeeded.length > 0)) {
      layout = "landscape-crop";
    }
  }

  if (layout === "landscape-crop") {
    [bsImg, isImg] = await Promise.all([
      bsNeeded.length > 0 ? pdfToCroppedBase64(pdfPath, BS_CROP, 400) : Promise.resolve(null),
      isNeeded.length > 0 ? pdfToCroppedBase64(pdfPath, IS_CROP, 400) : Promise.resolve(null),
    ]);
  }

  // 2) 若任一裁切失败，fallback 到 unified
  if (!bsImg && bsNeeded.length > 0) {
    return { ok: false, suggestions: [], error: "BS_CROP_FAILED（裁切资产负债表失败）", layout };
  }
  if (!isImg && isNeeded.length > 0) {
    return { ok: false, suggestions: [], error: "IS_CROP_FAILED（裁切利润表失败）", layout };
  }

  // 3) 独立调用
  const tasks: Promise<AiAnalyzeResult>[] = [];
  if (bsImg) tasks.push(callMultimodalBs(bsImg, bsRequest));
  if (isImg) tasks.push(callMultimodalIs(isImg, isRequest));
  const results = await Promise.allSettled(tasks);

  // 4) 合并
  const merged: AiFieldSuggestion[] = [];
  const errors: string[] = [];
  let modelUsed: string | undefined;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.ok) {
        merged.push(...r.value.suggestions);
        if (r.value.model_used) modelUsed = r.value.model_used;
      } else if (r.value.error) {
        errors.push(r.value.error);
      }
    } else {
      errors.push(`SPLIT_CALL_REJECTED: ${r.reason?.message || String(r.reason)}`);
    }
  }

  const isOk = merged.length > 0 || errors.length === 0;
  return {
    ok: isOk,
    suggestions: merged,
    error: isOk ? undefined : errors.join("; "),
    model_used: modelUsed,
    layout,
    pages: layout === "portrait-page" ? { bsPage, isPage } : undefined,
  };
}
