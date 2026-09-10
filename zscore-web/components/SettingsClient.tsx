"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ProviderPreset {
  key: string;
  label: string;
  base_url: string;
  vision_model: string;
  text_model: string;
  doc_url: string;
}

interface MaskedConfig {
  provider: string;
  base_url: string;
  vision_model: string;
  text_model: string;
  masked_key: string;
  configured: boolean;
}

export default function SettingsClient({
  initialConfig,
  presets,
}: {
  initialConfig: MaskedConfig;
  presets: ProviderPreset[];
}) {
  const router = useRouter();

  // 表单状态
  const [provider, setProvider] = useState(initialConfig.provider || "zhipu");
  const [baseUrl, setBaseUrl] = useState(initialConfig.base_url || "");
  const [visionModel, setVisionModel] = useState(initialConfig.vision_model || "");
  const [textModel, setTextModel] = useState(initialConfig.text_model || "");
  const [apiKey, setApiKey] = useState("");
  const [testModel, setTestModel] = useState(initialConfig.text_model || initialConfig.vision_model || "");

  // UI 状态
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; latency?: number; response?: string; error?: string } | null>(null);
  const [currentConfig, setCurrentConfig] = useState(initialConfig);

  // 选择 Provider 预设时自动填充
  function handleProviderChange(key: string) {
    setProvider(key);
    const preset = presets.find((p) => p.key === key);
    if (preset) {
      if (!baseUrl || confirm("切换 Provider 会覆盖当前的 API 地址和模型名，是否继续？")) {
        setBaseUrl(preset.base_url);
        setVisionModel(preset.vision_model);
        setTextModel(preset.text_model);
        setTestModel(preset.text_model || preset.vision_model);
      }
    }
    setMsg("");
    setTestResult(null);
  }

  // 测试连接
  async function handleTest() {
    if (!baseUrl.trim() || !testModel.trim()) {
      setTestResult({ ok: false, error: "请填写 API 地址和模型名" });
      return;
    }
    // 如果用户没输入新 key，用已保存的测试
    const useSaved = !apiKey.trim();
    if (!useSaved && apiKey.trim().length < 16) {
      setTestResult({ ok: false, error: "API Key 长度过短" });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/ai-key/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useSaved
            ? { use_saved: true }
            : { base_url: baseUrl.trim(), api_key: apiKey.trim(), model: testModel.trim() }
        ),
      });
      const data = await res.json();
      if (data.ok) {
        setTestResult({
          ok: true,
          latency: data.latency_ms,
          response: data.model_response,
        });
      } else {
        setTestResult({
          ok: false,
          error: data.error || data.message || "未知错误",
          latency: data.latency_ms,
        });
      }
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message || "网络错误" });
    } finally {
      setTesting(false);
    }
  }

  // 保存配置
  async function handleSave() {
    if (!apiKey.trim()) {
      setMsg("请输入 API Key");
      return;
    }
    if (!baseUrl.trim()) {
      setMsg("请填写 API 地址");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/settings/ai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          vision_model: visionModel.trim(),
          text_model: textModel.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg("保存失败：" + (data.error || res.status));
        return;
      }
      setMsg("保存成功 ✅");
      setApiKey("");
      setCurrentConfig({
        provider: data.data.provider,
        base_url: data.data.base_url,
        vision_model: data.data.vision_model,
        text_model: data.data.text_model,
        masked_key: data.data.masked_key,
        configured: true,
      });
      router.refresh();
    } catch (e: any) {
      setMsg("保存失败：" + (e?.message || "网络错误"));
    } finally {
      setSaving(false);
    }
  }

  // 删除配置
  async function handleDelete() {
    if (!confirm("确认清除已保存的 API 配置？")) return;
    setSaving(true);
    try {
      await fetch("/api/settings/ai-key", { method: "DELETE" });
      setMsg("已清除配置");
      setApiKey("");
      setCurrentConfig({
        provider: "zhipu",
        base_url: "",
        vision_model: "",
        text_model: "",
        masked_key: "",
        configured: false,
      });
      router.refresh();
    } catch (e: any) {
      setMsg("删除失败：" + (e?.message || "网络错误"));
    } finally {
      setSaving(false);
    }
  }

  const currentPreset = presets.find((p) => p.key === provider);
  const inputClass = "w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const labelClass = "block text-xs font-medium text-gray-700 mb-1";

  return (
    <div className="space-y-6">
      {/* 当前状态 */}
      <section className="border rounded-lg p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">当前配置状态</h2>
        {currentConfig.configured ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-gray-500">Provider</span>
              <code className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded">
                {currentConfig.provider}
              </code>
            </div>
            <div>
              <span className="text-gray-500">API Key</span>
              <code className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded font-mono">
                {currentConfig.masked_key}
              </code>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500">Base URL</span>
              <code className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded font-mono text-[11px] break-all">
                {currentConfig.base_url}
              </code>
            </div>
            <div>
              <span className="text-gray-500">视觉模型</span>
              <code className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded">
                {currentConfig.vision_model}
              </code>
            </div>
            <div>
              <span className="text-gray-500">文本模型</span>
              <code className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded">
                {currentConfig.text_model}
              </code>
            </div>
            <div className="col-span-2">
              <button
                onClick={handleDelete}
                disabled={saving}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                清除配置
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-amber-600 font-medium">⚠ 未配置</span>
            <span className="text-gray-500">请在下方填写并保存 API 配置</span>
          </div>
        )}
      </section>

      {/* 配置表单 */}
      <section className="border rounded-lg p-4 bg-white">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">配置 / 更新 API</h2>

        {/* Provider 选择 */}
        <div className="mb-3">
          <label className={labelClass}>Provider</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className={inputClass + " font-sans"}
          >
            {presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          {currentPreset?.doc_url && (
            <p className="text-[11px] text-gray-500 mt-1">
              获取 Key：{" "}
              <a
                href={currentPreset.doc_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:underline"
              >
                {currentPreset.doc_url}
              </a>
            </p>
          )}
        </div>

        {/* Base URL */}
        <div className="mb-3">
          <label className={labelClass}>
            API 地址 (Base URL)
            <span className="text-gray-400 font-normal ml-1">— OpenAI 兼容端点</span>
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className={inputClass}
          />
        </div>

        {/* 模型配置 */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={labelClass}>视觉模型 (Vision)</label>
            <input
              type="text"
              value={visionModel}
              onChange={(e) => setVisionModel(e.target.value)}
              placeholder="gpt-4o-mini / glm-4v-flash / ..."
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>文本模型 (Text)</label>
            <input
              type="text"
              value={textModel}
              onChange={(e) => setTextModel(e.target.value)}
              placeholder="gpt-4o-mini / glm-4-flash / ..."
              className={inputClass}
            />
          </div>
        </div>

        {/* API Key */}
        <div className="mb-3">
          <label className={labelClass}>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={currentConfig.configured ? "输入新 Key 以替换（留空则保持不变）" : "粘贴 API Key"}
            className={inputClass}
          />
          {currentConfig.configured && (
            <p className="text-[11px] text-gray-500 mt-1">
              当前：{currentConfig.masked_key}
            </p>
          )}
        </div>

        {/* 测试连接 */}
        <div className="mb-3 border-t pt-3">
          <label className={labelClass}>测试用模型</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
              placeholder="选择文本模型测试"
              className={inputClass + " flex-1"}
            />
            <button
              onClick={handleTest}
              disabled={testing || !baseUrl.trim() || !testModel.trim()}
              className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
            >
              {testing ? "测试中…" : "🔌 测试连接"}
            </button>
          </div>
          {testResult && (
            <div
              className={
                "mt-2 px-3 py-2 rounded text-xs " +
                (testResult.ok
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200")
              }
            >
              {testResult.ok ? (
                <span>
                  ✅ 连接成功 ({testResult.latency}ms) — 模型回复：
                  <code className="ml-1 bg-white px-1 rounded">{testResult.response}</code>
                </span>
              ) : (
                <span>
                  ❌ 连接失败{testResult.latency ? ` (${testResult.latency}ms)` : ""}：{testResult.error}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 保存按钮 */}
        <div className="flex items-center gap-3 pt-3 border-t">
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || !baseUrl.trim()}
            className="px-4 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存配置"}
          </button>
          <Link href="/" className="text-sm text-gray-600 hover:underline">
            ← 返回首页
          </Link>
          {msg && <span className="text-xs text-gray-600">{msg}</span>}
        </div>
      </section>

      {/* 约束 Prompt 说明 */}
      <section className="border rounded-lg p-4 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">AI 提取 Prompt 约束规则</h2>
        <div className="text-xs text-gray-600 space-y-1.5">
          <p>系统 Prompt 内置以下约束，确保跨 Provider 一致的提取质量：</p>
          <ul className="list-disc pl-4 space-y-1">
            <li><b>字段白名单：</b>仅允许返回 10 个预定义字段（流动资产/负债、总资产/负债、权益、留存收益、营收、EBIT 等），模型无法编造新字段</li>
            <li><b>JSON-only 输出：</b>禁止任何解释性文字、Markdown 标记、前后缀，只返回 JSON 数组</li>
            <li><b>金额归一：</b>所有金额以"元"为单位，千分位逗号自动去除</li>
            <li><b>未知即 null：</b>找不到的字段 value 设为 null，禁止猜测</li>
            <li><b>evidence 原文追溯：</b>每条结果必须附带财报原文行，便于人工核对</li>
            <li><b>confidence 分档：</b>1.0=直接命中 / 0.85=子项求和 / 0.7=会计恒等推算</li>
            <li><b>会计恒等推导：</b>留存收益=盈余公积+未分配利润；EBIT=利润总额+利息费用</li>
            <li><b>温度参数：</b>temperature=0.1，降低随机性</li>
          </ul>
        </div>
      </section>

      {/* 功能说明 */}
      <section className="border rounded-lg p-4 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">AI 分析补全功能说明</h2>
        <ul className="text-xs text-gray-600 space-y-1.5 list-disc pl-4">
          <li><b>触发条件：</b>分析结果含 <code className="bg-white px-1 rounded">人工补录 / OCR 识别 / 回退推导值</code> 字段时，详情页顶部出现「🤖 AI 分析补全」按钮</li>
          <li><b>双路并行：</b>视觉 OCR（PDF→PNG→Vision 模型）+ 文本分析（PDF 全文→Text 模型）</li>
          <li><b>合并优先级：</b>OCR 结果 &gt; 文本分析 &gt; 会计推算</li>
          <li><b>用户确认：</b>AI 建议值以蓝色高亮填入输入框，用户核对后点击「保存修改」才会写入</li>
          <li><b>数据安全：</b>API Key 存储在本机 <code className="bg-white px-1 rounded">data/ai-config.json</code>，不上传服务器</li>
        </ul>
      </section>
    </div>
  );
}
