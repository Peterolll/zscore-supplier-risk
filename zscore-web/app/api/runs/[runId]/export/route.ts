import { NextResponse } from "next/server";
import { getRunDetail } from "@/lib/db";
import { buildRunXlsx } from "@/lib/exportXlsx";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const buf = await buildRunXlsx(detail);
    // 纯 filename 段必须 ASCII（HTTP header 为 Latin1）；中文只放进 filename*=UTF-8''（浏览器优先采用）
    const displayName = `${detail.supplier.name}_ZScore_${detail.run.model.replace("'", "")}.xlsx`;
    const asciiName =
      `ZScore_${detail.supplier.name}_${detail.run.model.replace("'", "")}`
        .replace(/[^\x20-\x7E]+/g, "_")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 80) + ".xlsx";
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "EXPORT_FAILED", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
