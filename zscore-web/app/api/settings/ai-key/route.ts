// app/api/settings/ai-key/route.ts — AI Provider 配置 CRUD
//
// GET    → 返回当前配置（脱敏）
// POST   → 保存完整 provider 配置（provider, base_url, api_key, vision_model, text_model）
// DELETE → 清除配置

import { NextResponse } from "next/server";
import {
  getMaskedConfig,
  saveAiConfig,
  getAiConfig,
  PROVIDER_PRESETS,
} from "@/lib/ai-config";

export const runtime = "nodejs";

export async function GET() {
  const masked = getMaskedConfig();
  return NextResponse.json({
    ok: true,
    data: {
      ...masked,
      presets: Object.entries(PROVIDER_PRESETS).map(([key, val]) => ({
        key,
        label: val.label,
        base_url: val.base_url,
        vision_model: val.vision_model,
        text_model: val.text_model,
        doc_url: val.doc_url,
      })),
    },
  });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  // 兼容旧格式：只传 zhipu_api_key
  if (body.zhipu_api_key && !body.api_key) {
    body.api_key = body.zhipu_api_key;
    body.provider = body.provider || "zhipu";
    const preset = PROVIDER_PRESETS.zhipu;
    body.base_url = body.base_url || preset.base_url;
    body.vision_model = body.vision_model || preset.vision_model;
    body.text_model = body.text_model || preset.text_model;
  }

  const apiKey = (body.api_key as string) || "";
  if (!apiKey.trim()) {
    return NextResponse.json({ ok: false, error: "EMPTY_KEY" }, { status: 400 });
  }

  const trimmedKey = apiKey.trim();
  if (trimmedKey.length < 16) {
    return NextResponse.json({ ok: false, error: "KEY_TOO_SHORT" }, { status: 400 });
  }

  const provider = (body.provider as string) || "custom";
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;

  const baseUrl = (body.base_url as string)?.trim() || preset.base_url;
  if (!baseUrl) {
    return NextResponse.json({ ok: false, error: "EMPTY_BASE_URL" }, { status: 400 });
  }

  const visionModel = (body.vision_model as string)?.trim() || preset.vision_model;
  const textModel = (body.text_model as string)?.trim() || preset.text_model;

  saveAiConfig({
    provider,
    base_url: baseUrl,
    api_key: trimmedKey,
    vision_model: visionModel,
    text_model: textModel,
  });

  return NextResponse.json({
    ok: true,
    data: {
      provider,
      base_url: baseUrl,
      vision_model: visionModel,
      text_model: textModel,
      masked_key: trimmedKey.slice(0, 6) + "****" + trimmedKey.slice(-4),
    },
  });
}

export async function DELETE() {
  saveAiConfig({
    provider: "zhipu",
    base_url: PROVIDER_PRESETS.zhipu.base_url,
    api_key: "",
    vision_model: PROVIDER_PRESETS.zhipu.vision_model,
    text_model: PROVIDER_PRESETS.zhipu.text_model,
  });
  return NextResponse.json({ ok: true });
}
