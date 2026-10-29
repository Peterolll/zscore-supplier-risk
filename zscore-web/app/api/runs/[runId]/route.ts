import { NextResponse } from "next/server";
import { getRunDetail, saveResultOverride } from "@/lib/db";
import type { RiskZone, Industry } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(detail);
}

// 人工修正入口：{ fields?, riskOverride?, note?, industry?, listed?, equityValue? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }
  try {
    const allowed = new Set(["current_assets","current_liabilities","total_assets","total_liabilities","equity_total","equity_value","retained_earnings","revenue","profit_before_tax","interest_expense","ebit","finance_expenses","net_profit","income_tax","noncurrent_assets","noncurrent_liabilities","surplus_reserve","undistributed_profit"]);
    const fields: Record<string, number | null> = {};
    for (const [key,value] of Object.entries(body.fields ?? {})) {
      if (!allowed.has(key) || (value !== null && (typeof value !== "number" || !Number.isFinite(value))))
        return NextResponse.json({ok:false,error:"INVALID_FIELD"},{status:400});
      fields[key] = value as number | null;
    }
    if ((body.equityValue != null && (typeof body.equityValue !== "number" || !Number.isFinite(body.equityValue))) ||
        (body.industry !== undefined && !["manufacturing","service"].includes(body.industry)) ||
        (body.riskOverride != null && !["safe","grey","distress","unknown"].includes(body.riskOverride)))
      return NextResponse.json({ok:false,error:"INVALID_INPUT"},{status:400});
    saveResultOverride(runId, {
      fields,
      acceptedSuggestions: body.acceptedSuggestions,
      riskOverride: body.riskOverride as RiskZone | null | undefined,
      note: body.note,
      industry: body.industry as Industry | undefined,
      listed: typeof body.listed === "boolean" ? body.listed : undefined,
      equityValue: body.equityValue,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "SAVE_FAILED", message: e?.message === "STALE_SUGGESTION" ? "字段已发生变化，请重新核验后再保存" : "保存失败，请查看分析日志" },
      { status: e?.message === "STALE_SUGGESTION" ? 409 : 500 }
    );
  }
}
