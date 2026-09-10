// app/api/dictionary/gaps/route.ts — 字典缺口审核
// POST { id, action: "approve"|"ignore", field?, kind?, alias? }
//   approve → 写回 synonyms.json 对应 SYNONYMS 或 FIELD_TREE，并标记 gap resolved
//   ignore  → 标记 ignored

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveDictGap } from "@/lib/db";

export const runtime = "nodejs";

const WORKSPACE =
  process.env.ZSCORE_WORKSPACE || path.resolve(process.cwd(), "..");
const DICT_PATH = path.join(WORKSPACE, "zscore_pipeline/dict/synonyms.json");

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, action, field, kind, alias } = body as {
      id: string; action: string; field?: string; kind?: string; alias?: string;
    };
    if (!id || !action) {
      return NextResponse.json({ ok: false, error: "BAD_PARAMS" }, { status: 400 });
    }
    if (action === "approve") {
      if (!field || !alias) {
        return NextResponse.json(
          { ok: false, error: "NEED_FIELD_AND_ALIAS", message: "确认需要 field 和 alias" },
          { status: 400 }
        );
      }
      // 读取现有字典
      const raw = JSON.parse(fs.readFileSync(DICT_PATH, "utf-8"));
      const syns = raw.SYNONYMS || {};
      const tree = raw.FIELD_TREE || {};
      if (kind === "direct") {
        // 写入 SYNONYMS[field]
        if (!Array.isArray(syns[field])) syns[field] = [];
        if (!syns[field].includes(alias)) syns[field].push(alias);
      } else if (kind === "component" && tree[field]) {
        // 找到组件名（用户可传 alias 作为组件名，或默认添加到第一个组件）
        // 简化逻辑：创建一个"自定义"组件或追加到指定 component
        const compKey = body.component || "自定义";
        if (!tree[field].components) tree[field].components = {};
        if (!tree[field].components[compKey]) tree[field].components[compKey] = [];
        if (!tree[field].components[compKey].includes(alias)) {
          tree[field].components[compKey].push(alias);
        }
      } else {
        // 无 kind → 默认 direct
        if (!Array.isArray(syns[field])) syns[field] = [];
        if (!syns[field].includes(alias)) syns[field].push(alias);
      }
      raw.SYNONYMS = syns;
      raw.FIELD_TREE = tree;
      fs.writeFileSync(DICT_PATH, JSON.stringify(raw, null, 2), "utf-8");
      resolveDictGap(id, "resolved", `写入字典: ${field}/${kind || "direct"} = ${alias}`);
    } else if (action === "ignore") {
      resolveDictGap(id, "ignored", body.reason || "用户忽略");
    } else {
      return NextResponse.json({ ok: false, error: "BAD_ACTION" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "FAILED" },
      { status: 500 }
    );
  }
}
