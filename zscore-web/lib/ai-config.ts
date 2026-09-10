// lib/ai-config.ts — AI Provider 配置管理
//
// 支持任意 OpenAI-compatible API（智谱/OpenAI/Deepseek/Moonshot/自定义端点）
//
// 三级配置来源（优先级递减）：
//   1. 环境变量 ZSCORE_AI_API_KEY / ZSCORE_AI_BASE_URL / ZSCORE_AI_VISION_MODEL / ZSCORE_AI_TEXT_MODEL
//   2. data/ai-config.json （用户通过 /settings 页面写入）
//   3. 默认值（智谱 GLM）
//
// data/ai-config.json 结构：
// {
//   "provider": "zhipu" | "openai" | "deepseek" | "moonshot" | "custom",
//   "base_url": "https://open.bigmodel.cn/api/paas/v4",
//   "api_key": "xxx",
//   "vision_model": "glm-4v-flash",
//   "text_model": "glm-4-flash",
//   "updated_at": "2026-..."
// }

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(DATA_DIR, "ai-config.json");

/** 内置 Provider 预设 */
export const PROVIDER_PRESETS: Record<
  string,
  { label: string; base_url: string; vision_model: string; text_model: string; doc_url: string }
> = {
  zhipu: {
    label: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    vision_model: "glm-4v-flash",
    text_model: "glm-4-flash",
    doc_url: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  openai: {
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    vision_model: "gpt-4o-mini",
    text_model: "gpt-4o-mini",
    doc_url: "https://platform.openai.com/api-keys",
  },
  deepseek: {
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    vision_model: "deepseek-vl2",
    text_model: "deepseek-chat",
    doc_url: "https://platform.deepseek.com/api_keys",
  },
  moonshot: {
    label: "Moonshot (月之暗面)",
    base_url: "https://api.moonshot.cn/v1",
    vision_model: "moonshot-v1-8k-vision-preview",
    text_model: "moonshot-v1-8k",
    doc_url: "https://platform.moonshot.cn/console/api-keys",
  },
  custom: {
    label: "自定义 (OpenAI 兼容)",
    base_url: "",
    vision_model: "",
    text_model: "",
    doc_url: "",
  },
};

export interface AiConfig {
  provider: string; // "zhipu" | "openai" | "deepseek" | "moonshot" | "custom"
  base_url: string;
  api_key: string;
  vision_model: string;
  text_model: string;
  updated_at?: string;
}

/** 旧格式兼容：{ zhipu_api_key: "xxx" } → 新格式 */
function migrateOldFormat(raw: any): AiConfig | null {
  if (raw.provider && raw.base_url !== undefined) {
    // 已是新格式
    return raw as AiConfig;
  }
  // 旧格式：仅有 zhipu_api_key
  if (raw.zhipu_api_key) {
    return {
      provider: "zhipu",
      base_url: PROVIDER_PRESETS.zhipu.base_url,
      api_key: raw.zhipu_api_key,
      vision_model: PROVIDER_PRESETS.zhipu.vision_model,
      text_model: PROVIDER_PRESETS.zhipu.text_model,
      updated_at: raw.updated_at,
    };
  }
  return null;
}

function readConfigFile(): AiConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return migrateOldFormat(raw);
  } catch {
    return null;
  }
}

/** 读取当前生效的完整 AI 配置 */
export function getAiConfig(): AiConfig {
  // 1. 环境变量覆盖
  const envKey = process.env.ZSCORE_AI_API_KEY;
  const envBaseUrl = process.env.ZSCORE_AI_BASE_URL;
  const envVision = process.env.ZSCORE_AI_VISION_MODEL;
  const envText = process.env.ZSCORE_AI_TEXT_MODEL;

  if (envKey && envKey.trim()) {
    const baseUrl = envBaseUrl?.trim() || PROVIDER_PRESETS.zhipu.base_url;
    return {
      provider: "env",
      base_url: baseUrl,
      api_key: envKey.trim(),
      vision_model: envVision?.trim() || PROVIDER_PRESETS.zhipu.vision_model,
      text_model: envText?.trim() || PROVIDER_PRESETS.zhipu.text_model,
      updated_at: new Date().toISOString(),
    };
  }

  // 2. 配置文件
  const cfg = readConfigFile();
  if (cfg && cfg.api_key?.trim()) {
    return cfg;
  }

  // 3. 未配置
  return {
    provider: "zhipu",
    base_url: PROVIDER_PRESETS.zhipu.base_url,
    api_key: "",
    vision_model: PROVIDER_PRESETS.zhipu.vision_model,
    text_model: PROVIDER_PRESETS.zhipu.text_model,
  };
}

/** 返回当前 API key（向后兼容旧接口） */
export function getZhipuApiKey(): string {
  return getAiConfig().api_key;
}

/** 是否已配置 API key */
export function hasZhipuKey(): boolean {
  return getAiConfig().api_key.length > 0;
}

/** 是否已配置（通用接口） */
export function hasAiConfig(): boolean {
  const cfg = getAiConfig();
  return cfg.api_key.length > 0 && cfg.base_url.length > 0;
}

/** 写入配置文件 */
export function saveAiConfig(cfg: Partial<AiConfig>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const current: AiConfig | null = readConfigFile();
  const merged: AiConfig = {
    provider: cfg.provider ?? current?.provider ?? "zhipu",
    base_url: cfg.base_url ?? current?.base_url ?? PROVIDER_PRESETS.zhipu.base_url,
    api_key: cfg.api_key ?? current?.api_key ?? "",
    vision_model: cfg.vision_model ?? current?.vision_model ?? PROVIDER_PRESETS.zhipu.vision_model,
    text_model: cfg.text_model ?? current?.text_model ?? PROVIDER_PRESETS.zhipu.text_model,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
}

/** 向后兼容：仅写入 key（保持旧接口可用） */
export function saveZhipuApiKey(key: string): void {
  const cfg = getAiConfig();
  saveAiConfig({
    provider: cfg.provider === "env" ? "zhipu" : cfg.provider,
    base_url: cfg.base_url,
    api_key: key.trim(),
    vision_model: cfg.vision_model,
    text_model: cfg.text_model,
  });
}

/** 返回 key 的脱敏预览（前 6 + 后 4，中间用 * 填充） */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return key.slice(0, 2) + "****";
  return key.slice(0, 6) + "****" + key.slice(-4);
}

/** 返回配置的脱敏预览（用于前端展示） */
export function getMaskedConfig(): {
  provider: string;
  base_url: string;
  vision_model: string;
  text_model: string;
  masked_key: string;
  configured: boolean;
} {
  const cfg = getAiConfig();
  return {
    provider: cfg.provider,
    base_url: cfg.base_url,
    vision_model: cfg.vision_model,
    text_model: cfg.text_model,
    masked_key: maskKey(cfg.api_key),
    configured: cfg.api_key.length > 0,
  };
}
