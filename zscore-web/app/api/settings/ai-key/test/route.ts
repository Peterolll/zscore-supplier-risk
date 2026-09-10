// app/api/settings/ai-key/test/route.ts — API 连通性测试
//
// POST /api/settings/ai-key/test
//   body: { base_url, api_key, model }  — 测试指定配置
//   body: { use_saved: true }            — 用已保存的配置测试
//   body: {}                             — 无参数时也用已保存配置
//
// 返回: { ok: true, latency_ms, model_response } | { ok: false, error, latency_ms? }

import { NextResponse } from "next/server";
import { getAiConfig } from "@/lib/ai-config";
import { testApiConnection } from "@/lib/ai-client";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // 空 body 也行
  }

  let baseUrl: string;
  let apiKey: string;
  let model: string;

  if (body.use_saved || (!body.base_url && !body.api_key)) {
    // 使用已保存的配置
    const cfg = getAiConfig();
    baseUrl = cfg.base_url;
    apiKey = cfg.api_key;
    model = cfg.text_model || cfg.vision_model;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "NO_API_KEY", message: "未配置 API Key，请先保存" },
        { status: 400 }
      );
    }
  } else {
    // 使用请求体中的配置
    baseUrl = (body.base_url as string) || "";
    apiKey = (body.api_key as string) || "";
    model = (body.model as string) || "";

    if (!baseUrl.trim()) {
      return NextResponse.json(
        { ok: false, error: "EMPTY_BASE_URL", message: "请填写 API 地址" },
        { status: 400 }
      );
    }
    if (!apiKey.trim()) {
      return NextResponse.json(
        { ok: false, error: "EMPTY_KEY", message: "请填写 API Key" },
        { status: 400 }
      );
    }
    if (!model.trim()) {
      return NextResponse.json(
        { ok: false, error: "EMPTY_MODEL", message: "请填写模型名称" },
        { status: 400 }
      );
    }

    baseUrl = baseUrl.trim();
    apiKey = apiKey.trim();
    model = model.trim();
  }

  const result = await testApiConnection(baseUrl, apiKey, model);

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      latency_ms: result.latency_ms,
      model_response: result.model_response,
      message: `连接成功 (${result.latency_ms}ms)`,
    });
  } else {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        latency_ms: result.latency_ms,
        message: `连接失败：${result.error}`,
      },
      { status: 200 } // 返回 200 但 ok=false，前端统一用 data.ok 判断
    );
  }
}
