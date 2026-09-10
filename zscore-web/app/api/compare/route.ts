import { NextResponse } from "next/server";
import { getComparison } from "@/lib/db";

export const runtime = "nodejs";
const MAX_COMPARE = 50;

export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("ids");
  if (!ids) return NextResponse.json({ ok: false, error: "NO_IDS" }, { status: 400 });
  const runIds = ids.split(",").filter(Boolean).filter((s) => s.length < 100);
  if (runIds.length === 0) {
    return NextResponse.json({ ok: false, error: "EMPTY_IDS" }, { status: 400 });
  }
  if (runIds.length > MAX_COMPARE) {
    return NextResponse.json(
      { ok: false, error: "TOO_MANY_IDS", message: `最多对比 ${MAX_COMPARE} 个分析记录` },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, data: getComparison(runIds) });
}
