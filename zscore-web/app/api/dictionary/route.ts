// app/api/dictionary/route.ts — 数据字典 v2（指标树）+ 字典自审闭环
// GET：返回当前字典（含 SYNONYMS / FIELD_TREE / EQUITY_INCL_MINORITY）+ 待审缺口
// PUT：校验后写回 JSON（保留 FIELD_TREE），网页端编辑生效

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { listDictGaps } from "@/lib/db";

export const runtime = "nodejs";

const WORKSPACE =
  process.env.ZSCORE_WORKSPACE || path.resolve(process.cwd(), "..");
const DICT_PATH = path.join(WORKSPACE, "zscore_pipeline/dict/synonyms.json");

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeGaps = url.searchParams.get("gaps") !== "0";
    if (!fs.existsSync(DICT_PATH)) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "字典文件不存在" },
        { status: 404 }
      );
    }
    const raw = JSON.parse(fs.readFileSync(DICT_PATH, "utf-8"));
    const resp: Record<string, unknown> = { ok: true, dict: raw };
    if (includeGaps) {
      try { resp.gaps = listDictGaps("pending"); } catch { resp.gaps = []; }
    }
    return NextResponse.json(resp);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "READ_FAILED", message: e?.message },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const synonyms = body?.SYNONYMS;
    const fieldTree = body?.FIELD_TREE;
    const equity = body?.EQUITY_INCL_MINORITY;

    if (!synonyms || typeof synonyms !== "object" || Array.isArray(synonyms)) {
      return NextResponse.json(
        { ok: false, error: "BAD_SHAPE", message: "SYNONYMS 必须为对象" },
        { status: 400 }
      );
    }
    for (const [k, v] of Object.entries(synonyms)) {
      if (!Array.isArray(v) || !(v as unknown[]).every((x) => typeof x === "string")) {
        return NextResponse.json(
          { ok: false, error: "BAD_VALUE", message: `字段 ${k} 的值必须为字符串数组` },
          { status: 400 }
        );
      }
    }
    const out: Record<string, unknown> = {
      SYNONYMS: synonyms,
      EQUITY_INCL_MINORITY: Array.isArray(equity)
        ? equity.filter((x: unknown) => typeof x === "string")
        : [],
    };
    if (fieldTree && typeof fieldTree === "object" && !Array.isArray(fieldTree)) {
      out.FIELD_TREE = fieldTree;
    }
    fs.mkdirSync(path.dirname(DICT_PATH), { recursive: true });
    fs.writeFileSync(DICT_PATH, JSON.stringify(out, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "WRITE_FAILED", message: e?.message },
      { status: 500 }
    );
  }
}
