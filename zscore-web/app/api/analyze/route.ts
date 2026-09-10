import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runEngine } from "@/lib/engine";
import { saveAnalysis } from "@/lib/db";
import { saveDictGaps } from "@/lib/db";
import type { Industry, Period, Gaap } from "@/lib/types";

export const runtime = "nodejs";
// 最坏情况：扫描件流水线 3 次 OCR 约 90s + 上传/落盘/复算开销 → 180s 兜底
export const maxDuration = 180;

// 上传安全限制
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 10;
const ALLOWED_EXTS = /\.(pdf|pptx|ppt)$/i;
const ALLOWED_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/octet-stream", // 部分系统不识别 pptx MIME
];

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_FORM" }, { status: 400 });
  }

  const files = (form.getAll("file") as File[]).filter(Boolean);
  const file = files[0] ?? null;
  const industry = (form.get("industry") as Industry) || "manufacturing";
  const period = (form.get("period") as Period) || "annual";
  const gaap = (form.get("gaap") as Gaap) || "cas";
  const currency = (form.get("currency") as string) || "CNY";
  const listed = form.get("listed") === "1" || form.get("listed") === "true";
  const equityValRaw = (form.get("equity_value") as string) || "";
  const equityValue = equityValRaw ? Number(equityValRaw) : null;

  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "NO_FILE" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { ok: false, error: "TOO_MANY_FILES", message: `最多上传 ${MAX_FILES} 个文件` },
      { status: 400 }
    );
  }

  // 文件大小 + 扩展名 + MIME 校验
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "FILE_TOO_LARGE", message: `文件 ${f.name} 超过 50MB 限制` },
        { status: 413 }
      );
    }
    if (!ALLOWED_EXTS.test(f.name)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TYPE", message: `文件 ${f.name} 不是 PDF/PPTX` },
        { status: 400 }
      );
    }
    // MIME 校验：允许 application/octet-stream（部分系统不识别 pptx）
    if (f.type && !ALLOWED_MIMES.includes(f.type)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_MIME", message: `文件 ${f.name} MIME 类型不被允许: ${f.type}` },
        { status: 400 }
      );
    }
  }

  // 落盘上传的财报文件（支持多文件：多张 PDF 由引擎合并；PPTX 单次）
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const paths: string[] = [];
  const savedNames: string[] = [];
  for (const f of files) {
    const safeName = f.name.replace(/[^\w.\-一-龥]/g, "_");
    const fname = `${Date.now()}_${savedNames.length}_${safeName}`;
    const fpath = path.join(uploadsDir, fname);
    const buf = Buffer.from(await f.arrayBuffer());
    await writeFile(fpath, buf);
    paths.push(fpath);
    savedNames.push(f.name);
  }
  // 合并场景下的供应商名：取首个文件名（去后缀）
  const displayName =
    (form.get("name") as string) ||
    (files.length > 1 ? savedNames.join("+") : file!.name.replace(/\.(pdf|pptx|ppt)$/i, "")) ||
    "未命名供应商";

  // 调用 Python 计算引擎（PDF / PPTX 均可；多 PDF 自动合并）
  const result = await runEngine({
    pdfPaths: paths, name: displayName, industry, period, gaap, currency, listed, equityValue,
  });
  if (!result.ok) {
    const status = result.error === "OCR_UNAVAILABLE" ? 422 : 500;
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status }
    );
  }

  // 持久化
  const saved = saveAnalysis({
    profile: {
      name: displayName,
      industry_class: result.profile!.industry_class,
      period_type: result.profile!.period_type,
      gaap: result.profile!.gaap,
      currency: result.profile!.currency,
      source_file: paths.join("|"),
      listed: result.profile!.listed,
      equity_value: result.profile!.equity_value,
    },
    method: result.method!,
    zscore: result.zscore!,
    extraction: result.extraction!,
  });

  // 字典自审：未识别科目入 dict_gap 表
  const gaps = (result.extraction as any)?.dict_gaps as Array<{
    label: string; value: number; page: number | null;
    suggested_field: string | null; suggested_kind: string | null;
  }> | undefined;
  if (gaps && gaps.length > 0) {
    try { saveDictGaps(saved.runId, displayName, gaps); } catch {}
  }

  return NextResponse.json({
    ok: true,
    supplierId: saved.supplierId,
    runId: saved.runId,
    result,
  });
}
