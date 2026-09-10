// app/api/runs/[runId]/ai-analyze/route.ts — AI 分析补全端点
//
// POST /api/runs/[runId]/ai-analyze
//   body: {
//     fields?: string[]  (指定字段；省略则自动检测 value==null 的字段)
//     mode?:   "split" | "unified"   (默认 "split")
//   }
//
// 模式说明：
//   - split  (默认, v4): 拆 BS/IS 两个独立 call + 各自裁切图 + 各自聚焦 prompt。
//     在 Lenovo DT 测试中 8/8 全对。cost ≈ 2× unified 成本。
//   - unified (v0/v1): 单次 call + 全文+全图（兼容所有 PDF 布局）。
//     在 Lenovo DT 测试中 4/8，弱项为 总负债/股东权益/EBIT。
//   - 若 split 失败（裁切/调用），自动 fallback 到 unified。

import { NextResponse } from "next/server";
import { getRunDetail } from "@/lib/db";
import { getAiConfig, hasAiConfig } from "@/lib/ai-config";
import {
  callMultimodalModel,
  callMultimodalSplitModel,
  pdfToImagesBase64,
  extractPdfText,
  AiFieldSuggestion,
} from "@/lib/ai-client";
import { applySanityChecks, compareAgainstPipeline } from "@/lib/validation";
import { runEngine } from "@/lib/engine";

export const runtime = "nodejs";
export const maxDuration = 180; // split 模式 = 2× 视觉模型调用

const ALL_FIELDS = [
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
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  // 1. 检查 API 配置
  if (!hasAiConfig()) {
    return NextResponse.json(
      { ok: false, error: "NO_API_KEY", message: "请先在设置页面配置 AI API" },
      { status: 401 }
    );
  }

  // 2. 读取 run 详情
  const detail = getRunDetail(runId);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "RUN_NOT_FOUND" }, { status: 404 });
  }

  // 3. 解析请求体
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // 空 body 也行，走默认
  }
  const mode: "split" | "unified" = body.mode === "unified" ? "unified" : "split";

  // 4. 检测需要补全的字段
  const isFieldEmpty = (f: any) => {
    if (!f) return true;
    if (f.value == null) return true;
    if (f.value === 0 && f.method !== "engine") return true; // 0 且非引擎提取，视为空
    return false;
  };

  let requestedFields: string[];
  if (Array.isArray(body.fields) && body.fields.length > 0) {
    requestedFields = body.fields.filter((f: string) => ALL_FIELDS.includes(f));
  } else {
    requestedFields = ALL_FIELDS.filter((k) => {
      const f = detail.fields.find((x) => x.field_key === k);
      return isFieldEmpty(f);
    });
  }

  if (requestedFields.length === 0) {
    return NextResponse.json({
      ok: true,
      suggestions: [],
      message: "所有字段已确认，无需 AI 补全",
      mode,
    });
  }

  // 5. 获取 PDF 路径
  const sourceFile = detail.supplier.source_file;
  if (!sourceFile) {
    return NextResponse.json({ ok: false, error: "NO_SOURCE_FILE" }, { status: 400 });
  }
  const pdfPath = sourceFile.split("|")[0];
  const fs = await import("node:fs");
  if (!fs.existsSync(pdfPath)) {
    return NextResponse.json(
      { ok: false, error: "FILE_NOT_FOUND", message: `PDF 文件不存在：${pdfPath}` },
      { status: 404 }
    );
  }

  // 6. 已提取字段作为参考锚点
  const extractedFields: Record<string, number | null> = {};
  for (const f of detail.fields) {
    if (f.value != null) {
      extractedFields[f.field_key] = f.value;
    }
  }

  // 6.5 并行复跑 Python 流水线取新鲜 extraction.fields 作"量级比对锚点"
  //     流水线基于 pdfplumber 结构化文本解析，在实测中远强于弱视觉模型
  //     （例：资产总计 AI=126.6M vs 流水线=5.92B，偏差≈47 倍）。
  //     runEngine 失败不阻断 AI 分析（降级为跳过比对）。
  //
  //     修复 Bug：原实现 await runEngine 在 AI 调用前同步完成 → 伪并行，每次白等 30-60s。
  //     现改为发起 Promise 但不立即 await，与下方 AI 调用并行执行，在第 10.5 步前才 await 汇合。
  const pipelinePromise = (async () => {
    try {
      const pr = await runEngine({
        pdfPaths: [pdfPath],
        name: detail.supplier.name,
        industry: detail.supplier.industry,
        period: detail.supplier.period,
        gaap: detail.supplier.gaap,
        currency: detail.supplier.currency || "CNY",
        listed: detail.supplier.listed === 1,
        equityValue: detail.supplier.equity_value,
      });
      if (pr.ok && pr.extraction?.fields) {
        const pf: Record<string, number | null> = {};
        for (const [k, f] of Object.entries(pr.extraction.fields)) {
          if (f.value != null) pf[k] = f.value;
        }
        return { fields: pf, error: undefined as string | undefined };
      }
      return { fields: {} as Record<string, number | null>, error: (pr.error || "PIPELINE_FAILED") as string };
    } catch (e: any) {
      return { fields: {} as Record<string, number | null>, error: (e?.message || String(e)) as string };
    }
  })();

  // 7. 模式分发
  const errors: string[] = [];
  let results: AiFieldSuggestion[] = [];
  let modelsUsed: string[] = [];
  let actualMode = mode;
  // 版面策略与页码（诊断用，便于定位"裁错页/裁错区域"类问题）
  let layoutUsed: "landscape-crop" | "portrait-page" | undefined;
  let pagesUsed: { bsPage: number; isPage: number } | undefined;

  if (mode === "split") {
    // 7a. Split 模式：拆 BS/IS 独立 call
    try {
      const r = await callMultimodalSplitModel(pdfPath, requestedFields);
      if (r.ok) {
        results = r.suggestions;
        if (r.model_used) modelsUsed.push(r.model_used);
        if (r.layout) layoutUsed = r.layout;
        if (r.pages) pagesUsed = r.pages;
      } else {
        errors.push(`SPLIT: ${r.error || "unknown"}`);
        if (r.layout) layoutUsed = r.layout;
        // Fallback 到 unified
        actualMode = "unified";
      }
    } catch (e: any) {
      errors.push(`SPLIT_EXCEPTION: ${e?.message || String(e)}`);
      actualMode = "unified";
    }
  }

  if (actualMode === "unified") {
    // 7b. Unified 模式：单 call + 全文+全图
    let pdfText = "";
    let images: string[] = [];
    try {
      pdfText = await extractPdfText(pdfPath);
    } catch (e: any) {
      errors.push(`PDF 文本提取异常：${e?.message || String(e)}`);
    }
    try {
      images = await pdfToImagesBase64(pdfPath, 5);
      if (images.length === 0 && !pdfText.trim()) {
        errors.push("PDF 转图片与文本提取均失败（可能缺少 pdftoppm / pdftotext）");
      }
    } catch (e: any) {
      errors.push(`PDF 转图片失败：${e?.message || String(e)}`);
    }

    const res = await callMultimodalModel(pdfText, images, ALL_FIELDS, requestedFields);
    if (res.ok) {
      results = res.suggestions;
      if (res.model_used) modelsUsed.push(res.model_used);
    } else {
      errors.push(`UNIFIED: ${res.error || "unknown"}`);
    }
  }

  // 8. 仅保留请求的字段（注意：results 保留全量，供下方恒等推导使用）
  const finalSuggestions = results.filter((s) => requestedFields.includes(s.field_key));

  // 8.5 统一取值器：① 库中已确认值 → ② 本次 AI 原始返回（未过滤，含未请求的旁证字段）
  //     ⚠️ 旧实现用 finalSuggestions（已按 requestedFields 过滤）找 PBT，
  //        当只请求 ebit 时 PBT 已被过滤掉 → 恒等推导永远失效。此处改为查全量 results。
  const rawByKey = new Map<string, number>();
  for (const s of results) {
    if (s.value != null && !rawByKey.has(s.field_key)) rawByKey.set(s.field_key, s.value);
  }
  const pick = (k: string): number | null => {
    const fromDb = extractedFields[k];
    if (fromDb != null) return fromDb;
    const fromAi = rawByKey.get(k);
    return fromAi != null ? fromAi : null;
  };

  // 9. 推算补充：EBIT = 利润总额 + 利息费用（如 AI 没返回但 PBT/利息费用可得）
  if (requestedFields.includes("ebit")) {
    const hasEbit = finalSuggestions.some((s) => s.field_key === "ebit" && s.value != null);
    if (!hasEbit) {
      const pbt = pick("profit_before_tax");
      const ie = pick("interest_expense");
      if (pbt != null && ie != null) {
        finalSuggestions.push({
          field_key: "ebit",
          field_label: "息税前利润（EBIT）",
          value: pbt + ie,
          confidence: 0.9,
          evidence: `会计恒等推算：利润总额(${pbt}) + 利息费用(${ie}) = ${pbt + ie}`,
          method: "ai_derived",
        });
      }
    }
  }

  // 9.2 EBIT 恒等校正：AI 有时把「财务费用」/「营业利润」等任意一行错当成 ebit 返回；
  //      只要 PBT 和利息费用都已确认，恒等式 EBIT = PBT + 利息费用 是确定值，可信度高于
  //      单次 OCR 的随机猜测。一旦 AI 读数与恒等式差异 > 5%（绝对差超 100），以恒等式为准。
  //      保留 AI 原值于 evidence，便于事后追溯。
  if (requestedFields.includes("ebit")) {
    const pbt = pick("profit_before_tax");
    const ie = pick("interest_expense");
    if (pbt != null && ie != null) {
      const derived = pbt + ie;
      const aiEbit = finalSuggestions.find(
        (s) => s.field_key === "ebit" && s.value != null
      );
      if (aiEbit && Math.abs((aiEbit.value as number) - derived) >
          Math.max(100, Math.abs(derived) * 0.05)) {
        const oldValue = aiEbit.value;
        const oldEvidence = aiEbit.evidence;
        aiEbit.value = derived;
        aiEbit.method = "ai_derived";
        aiEbit.confidence = Math.min(aiEbit.confidence ?? 1, 0.85);
        aiEbit.evidence =
          `已按会计恒等式校正：利润总额(${pbt}) + 利息费用(${ie}) = ${derived}；` +
          `AI 原读数 ${oldValue}（来源：${oldEvidence}），量级不符已覆盖`;
        aiEbit.warning = "AI 读数与恒等式不符，已用 EBIT=PBT+利息费用 覆盖";
      }
    }
  }

  // 9.5 反向推导：利润总额 = EBIT − 利息费用
  //     场景：早期 prompt 让模型把「三、利润总额」直接填进 ebit，profit_before_tax 反而为 null。
  //     此时由 ebit 与利息费用反解出税前利润，避免"税前利润永远识别不到"。
  if (requestedFields.includes("profit_before_tax")) {
    const hasPbt = finalSuggestions.some(
      (s) => s.field_key === "profit_before_tax" && s.value != null
    );
    if (!hasPbt) {
      const ebit = pick("ebit");
      const ie = pick("interest_expense");
      if (ebit != null && ie != null) {
        finalSuggestions.push({
          field_key: "profit_before_tax",
          field_label: "利润总额（税前利润）",
          value: ebit - ie,
          confidence: 0.85,
          evidence: `会计恒等反推：EBIT(${ebit}) − 利息费用(${ie}) = ${ebit - ie}`,
          method: "ai_derived",
        });
      }
    }
  }

  // 10. 跨字段量级二次校验（不依赖换模型，兜底"弱模型双丢末位"）
  //     extractedFields 为库中已确认值（可信锚点），AI 建议优先覆盖同名键参与复校
  applySanityChecks(finalSuggestions, extractedFields);

  // 10.5 实时量级比对：将 AI 建议值与流水线（pdfplumber）新鲜提取值逐字段比对。
  //      这是治本弱视觉模型"自洽但全错"最可靠的兜底——流水线基于结构化文本解析，
  //      远强于 GLM-4V-Flash 等弱视觉模型；两者对同字段差异达 3 倍或符号相反即告警。
  //      中立"差异"告警，不预设哪边对，交由用户核对原文裁决。
  //
  //      此时 await 汇合第 6.5 步发起的并行流水线复跑（与 AI 调用并行执行，不额外等待）。
  const { fields: pipelineFields, error: pipelineError } = await pipelinePromise;
  compareAgainstPipeline(finalSuggestions, pipelineFields);

  // 11. ok 判定
  const hasSuggestions = finalSuggestions.length > 0;
  const hasErrors = errors.length > 0;
  const isOk = hasSuggestions || !hasErrors;

  return NextResponse.json({
    ok: isOk,
    suggestions: finalSuggestions,
    requested_fields: requestedFields,
    mode: actualMode,
    mode_requested: mode,
    fallback: actualMode !== mode,
    layout: layoutUsed,
    pages: pagesUsed,
    models_used: [...new Set(modelsUsed)],
    errors: hasErrors ? errors : undefined,
    error: !isOk && hasErrors ? errors.join("; ") : undefined,
    message: !isOk && hasErrors
      ? "AI 分析全部失败：" + errors.join("; ")
      : !hasSuggestions
      ? "AI 未找到可补全的字段（所有科目均返回 null）"
      : undefined,
    api_key_masked: (() => {
      const k = getAiConfig().api_key;
      return k ? k.slice(0, 6) + "****" : "";
    })(),
    pipeline_anchors: Object.keys(pipelineFields).length
      ? Object.keys(pipelineFields)
      : undefined,
    pipeline_error: pipelineError,
  });
}
