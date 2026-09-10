// app/settings/page.tsx — AI 配置设置页

import { getMaskedConfig, PROVIDER_PRESETS } from "@/lib/ai-config";
import SettingsClient from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = getMaskedConfig();

  const presets = Object.entries(PROVIDER_PRESETS).map(([key, val]) => ({
    key,
    label: val.label,
    base_url: val.base_url,
    vision_model: val.vision_model,
    text_model: val.text_model,
    doc_url: val.doc_url,
  }));

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">设置</h1>
      <p className="text-sm text-gray-600 mb-6">
        配置 AI 分析功能所需的 API。支持智谱 GLM、OpenAI、Deepseek、Moonshot 及任意 OpenAI 兼容端点。配置后，详情页中含人工补录 / OCR 识别 / 回退推导值的字段可点击「🤖 AI 分析补全」自动补全。
      </p>
      <SettingsClient
        initialConfig={cfg}
        presets={presets}
      />
    </div>
  );
}
