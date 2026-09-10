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
    // 清洗 fields：仅保留数值（含 0），剔除空串/NaN
    const fields: Record<string, number | null> | undefined = body.fields
      ? Object.fromEntries(
          Object.entries(body.fields as Record<string, unknown>)
            .filter(([, v]) => v !== "" && v !== null && v !== undefined && !Number.isNaN(Number(v)))
            .map(([k, v]) => [k, Number(v)])
        )
      : undefined;
    saveResultOverride(runId, {
      fields,
      riskOverride: (body.riskOverride ?? null) as RiskZone | null,
      note: body.note,
      industry: body.industry as Industry | undefined,
      listed: typeof body.listed === "boolean" ? body.listed : undefined,
      equityValue: body.equityValue != null ? Number(body.equityValue) : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "SAVE_FAILED" },
      { status: 500 }
    );
  }
}
