import { NextResponse } from "next/server";
import { listSuppliers, deleteSuppliers } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, data: listSuppliers() });
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string" && id.length < 100) : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "EMPTY_IDS" }, { status: 400 });
    }
    if (ids.length > 50) {
      return NextResponse.json({ ok: false, error: "TOO_MANY_IDS", message: "单次最多删除 50 个供应商" }, { status: 400 });
    }
    const deleted = deleteSuppliers(ids);
    return NextResponse.json({ ok: true, data: { deleted } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DELETE_FAILED", message: String(e) }, { status: 500 });
  }
}
