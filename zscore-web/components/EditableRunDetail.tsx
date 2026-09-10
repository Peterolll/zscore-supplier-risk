"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ZGauge from "./ZGauge";
import RiskBadge from "./RiskBadge";
import FactorBars from "./FactorBars";
import EvidenceTable from "./EvidenceTable";
import FactorDetailCard from "./FactorDetailCard";
import {
  computeZ,
  zoneOf,
  modelForProfile,
  buildFactorBreakdown,
  fieldNeedsConfirm,
  type FactorBreakdown,
} from "@/lib/zscore";
import {
  Z_FORMULA,
  ZONE_COLORS,
  ZONE_LABELS,
  INDUSTRY_LABELS,
  LISTED_LABELS,
} from "@/lib/constants";
import type { RunDetail, RiskZone, Industry } from "@/lib/types";

const ALL_X = ["X1", "X2", "X3", "X4", "X5"] as const;

export default function EditableRunDetail({ detail }: { detail: RunDetail }) {
  const router = useRouter();
  const { run, supplier, factors, fields, override } = detail;
  const runId = run.id;

  const [industry, setIndustry] = useState<Industry>(supplier.industry as Industry);
  const [listed, setListed] = useState<boolean>(supplier.listed === 1);
  const [equityValue, setEquityValue] = useState<string>(
    supplier.equity_value != null ? String(supplier.equity_value) : ""
  );
  const [riskOverride, setRiskOverride] = useState<RiskZone | "">(
    override?.risk_overridden ? (override.risk_override as RiskZone) : ""
  );
  const [note, setNote] = useState<string>(override?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiMsg, setAiMsg] = useState<string>("");
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, { value: number; evidence: string; method: string; confidence: number; warning?: string }>>({});
  const [fieldAiLoading, setFieldAiLoading] = useState<Record<string, boolean>>({});
  const [fieldAiMsg, setFieldAiMsg] = useState<Record<string, string>>({});

  const model = modelForProfile(listed, industry);

  // X1–X5 子指标：只读，来源为引擎提取（人工修正仅作用于风险评级，不改子指标）
  const xValues: Record<string, number | null> = {};
  for (const k of ALL_X) {
    const f = factors.find((x) => x.key === k);
    xValues[k] = f && f.value != null ? f.value : null;
  }
  const liveZ = computeZ(xValues, model);
  const liveZone: RiskZone = riskOverride ? riskOverride : zoneOf(liveZ, model);
  const overridden = riskOverride !== "";

  const liveFactors = ALL_X.map((k) => ({ key: k, value: xValues[k] }));

  // 子指标计算明细（展示用：含义 + 公式 + 代入数值演算 + 系数×值=对Z贡献）
  const breakdowns: FactorBreakdown[] = buildFactorBreakdown(
    xValues,
    fields,
    model,
    run.annualize_factor || 1
  );

  async function handleSave() {
    setSaving(true);
    setMsg("");
    // 收集发生变化的财务字段（仅回传改动项，避免把自动提取字段误标为人工补录）
    const changed: Record<string, number> = {};
    for (const f of EDIT_FIELDS) {
      const ex = fields.find((x) => x.field_key === f.key);
      const cur = ex && ex.value != null ? String(ex.value) : "";
      const next = (fieldEdits[f.key] ?? "").trim();
      if (next !== "" && next !== cur) {
        const n = Number(next);
        if (!Number.isNaN(n)) changed[f.key] = n;
      }
    }
    try {
      const res = await fetch(`/api/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: Object.keys(changed).length ? changed : undefined,
          riskOverride: riskOverride || null,
          note,
          industry,
          listed,
          equityValue: equityValue ? Number(equityValue) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg("保存失败：" + (data.error || res.status));
      } else {
        setMsg(
          Object.keys(changed).length
            ? `已保存 ${Object.keys(changed).length} 项修正并重新计算 Z ✅`
            : "已保存 ✅"
        );
        setFieldEdits({}); // 清空编辑态，输入框改回显示存储值
        router.refresh();
      }
    } catch (e: any) {
      setMsg("保存失败：" + (e?.message || "网络错误"));
    } finally {
      setSaving(false);
    }
  }

  const gatesPassed = (run.gates_passed || "").split(",").filter(Boolean);
  const gatesFailed = (run.gates_failed || "").split(",").filter(Boolean);
  const notes = (run.notes || "").split(",").filter(Boolean);

  // 可编辑财务字段（抓不到时人工手填）；初值取已存储值
  const EDIT_FIELDS: { key: string; label: string }[] = [
    { key: "current_assets", label: "流动资产" },
    { key: "current_liabilities", label: "流动负债" },
    { key: "total_assets", label: "总资产" },
    { key: "total_liabilities", label: "总负债" },
    { key: "equity_total", label: "权益总计(账面)" },
    { key: "equity_value", label: "股权价值(市值)" },
    { key: "retained_earnings", label: "留存收益" },
    { key: "revenue", label: "营业收入" },
    { key: "profit_before_tax", label: "税前利润" },
    { key: "interest_expense", label: "利息费用" },
    { key: "ebit", label: "息税前利润(EBIT)" },
  ];
  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of EDIT_FIELDS) {
      const ex = fields.find((x) => x.field_key === f.key);
      init[f.key] = ex && ex.value != null ? String(ex.value) : "";
    }
    return init;
  });

  // 待人工确认字段计数（人工补录 / OCR / 回退推导）
  const needsConfirmCount = fields.filter((f) => fieldNeedsConfirm(f)).length;

  // AI 分析补全：调用 /api/runs/[runId]/ai-analyze
  //   默认 mode="split"（拆 BS/IS 独立 call，准确率 8/8，cost ≈ 2× unified）
  //   字段级 (fieldKey) 与整体分析共用同一路由，仅 fields 参数不同
  // fieldKey: 指定单个字段分析；省略则自动分析所有空缺字段
  async function handleAiAnalyze(fieldKey?: string) {
    if (fieldKey) {
      setFieldAiLoading((prev) => ({ ...prev, [fieldKey]: true }));
    } else {
      setAiAnalyzing(true);
    }
    setAiMsg("");
    const t0 = Date.now();
    try {
      const payload: any = { mode: "split" };
      if (fieldKey) payload.fields = [fieldKey];
      const res = await fetch(`/api/runs/${runId}/ai-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      // 后端可能在 HTTP 200 下返回 ok=false（AI 全部失败但请求本身成功）
      if (!res.ok) {
        // HTTP 非 200（404/401/500 等）才是真正的请求失败
        const errMsg = "AI 分析失败：" + (data.error || data.message || `HTTP ${res.status}`);
        if (fieldKey) {
          setFieldAiLoading((prev) => ({ ...prev, [fieldKey]: false }));
        } else {
          setAiMsg(errMsg);
        }
        return;
      }
      if (!data.ok) {
        // HTTP 200 但 ok=false → AI 调用失败（如 API Key 过期、模型不可用等）
        const errDetail = data.error || data.message || data.errors?.join("; ") || "未知原因";
        const errMsg = "AI 分析失败：" + errDetail;
        if (fieldKey) {
          setFieldAiLoading((prev) => ({ ...prev, [fieldKey]: false }));
          setFieldAiMsg((prev) => ({ ...prev, [fieldKey]: errMsg }));
        } else {
          setAiMsg(errMsg);
        }
        return;
      }
      const sugs = data.suggestions || [];
      if (sugs.length === 0) {
        const emptyMsg = "AI 分析完成，但未找到可补全的字段。" + (data.errors ? "（" + data.errors.join("; ") + "）" : "");
        if (fieldKey) {
          setFieldAiLoading((prev) => ({ ...prev, [fieldKey]: false }));
          setFieldAiMsg((prev) => ({ ...prev, [fieldKey]: emptyMsg }));
        } else {
          setAiMsg(emptyMsg);
        }
        return;
      }
      // 仅写入建议（aiSuggestions），【不】自动覆盖输入框。
      // 用户必须点击"采纳"才把 AI 值写入字段；"忽略"则保持原数字不变。
      const newSugs: Record<string, { value: number; evidence: string; method: string; confidence: number; warning?: string }> = {};
      for (const s of sugs) {
        if (s.value == null || s.value === 0) continue;
        newSugs[s.field_key] = {
          value: s.value,
          evidence: s.evidence,
          method: s.method,
          confidence: s.confidence,
          warning: s.warning,
        };
      }
      const filledCount = Object.keys(newSugs).length;
      setAiSuggestions((prev) => ({ ...prev, ...newSugs }));
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const models = data.models_used ? "（模型：" + data.models_used.join(", ") + "）" : "";
      const modeUsed = data.mode ? `[${data.mode}${data.fallback ? " ← unified fallback" : ""}]` : "";
      const resultMsg = `AI 分析完成 ${modeUsed} ${models} 共 ${filledCount} 条建议（${elapsed}s），请逐条核对后点击"采纳"替换原值，或"忽略"保留原数字。`;
      if (fieldKey) {
        setFieldAiLoading((prev) => ({ ...prev, [fieldKey]: false }));
        setFieldAiMsg((prev) => ({ ...prev, [fieldKey]: resultMsg }));
      } else {
        setAiMsg(resultMsg);
      }
    } catch (e: any) {
      const errMsg = "AI 分析失败：" + (e?.message || "网络错误");
      if (fieldKey) {
        setFieldAiLoading((prev) => ({ ...prev, [fieldKey]: false }));
        setFieldAiMsg((prev) => ({ ...prev, [fieldKey]: errMsg }));
      } else {
        setAiMsg(errMsg);
      }
    } finally {
      if (!fieldKey) setAiAnalyzing(false);
    }
  }

  // 接受某个字段的 AI 建议（填入输入框）
  function acceptAiSuggestion(fieldKey: string) {
    const sug = aiSuggestions[fieldKey];
    if (!sug) return;
    setFieldEdits((prev) => ({ ...prev, [fieldKey]: String(sug.value) }));
  }

  // 忽略某个字段的 AI 建议
  function dismissAiSuggestion(fieldKey: string) {
    setAiSuggestions((prev) => {
      const updated = { ...prev };
      delete updated[fieldKey];
      return updated;
    });
    setFieldAiMsg((prev) => {
      const updated = { ...prev };
      delete updated[fieldKey];
      return updated;
    });
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{supplier?.name}</h2>
        <RiskBadge zone={liveZone} />
        {overridden && (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold border border-amber-400 bg-amber-50 text-amber-700">
            人工覆盖
          </span>
        )}
        <span className="text-xs text-gray-600">
          {model} · {run.method}
          {run.annualized ? ` · 流量年化×${run.annualize_factor}` : ""} · {run.created_at}
        </span>
      </div>
      <div className="text-xs text-gray-600">
        {listed ? LISTED_LABELS.listed : LISTED_LABELS.unlisted} · {INDUSTRY_LABELS[industry]} · {supplier?.period} · {supplier?.gaap} · {supplier?.currency}
      </div>

      {/* 待人工确认横幅 */}
      {needsConfirmCount > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg px-3 py-2 text-sm text-amber-800 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">⚠ {needsConfirmCount} 项数字待人工确认</span>
            <span className="text-amber-700/90">含人工补录 / OCR 识别 / 回退推导值。可点击 <b>🤖 AI 分析补全</b>（或各字段旁的 🤖）由 AI 自动识别，识别结果需你逐条「采纳」后才替换原值。</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleAiAnalyze()}
              disabled={aiAnalyzing}
              className="px-3 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {aiAnalyzing ? "🤖 AI 分析中…" : "🤖 AI 分析补全"}
            </button>
            <a href="/settings" className="text-xs text-indigo-600 hover:underline">
              配置 API Key
            </a>
            {aiMsg && <span className="text-xs text-indigo-700">{aiMsg}</span>}
          </div>
        </div>
      )}

      {/* 公司类型（上市/非上市）切换：决定 Z 模型路径 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">公司类型：</span>
        {([
          { k: false, label: LISTED_LABELS.unlisted },
          { k: true, label: LISTED_LABELS.listed },
        ] as const).map((o) => (
          <button
            key={String(o.k)}
            onClick={() => setListed(o.k)}
            className={`px-3 py-1 rounded-md text-sm border ${
              listed === o.k
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {o.label}
          </button>
        ))}
        <span className="text-[11px] text-gray-600">
          上市 → 原始 Z（5 因子，X4=股权市值÷总负债）；非上市 → Z′(制造)/Z″(非制造)
        </span>
      </div>

      {/* 行业类型切换 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">行业类型：</span>
        {(["manufacturing", "service"] as Industry[]).map((v) => (
          <button
            key={v}
            onClick={() => setIndustry(v)}
            className={`px-3 py-1 rounded-md text-sm border ${
              industry === v
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {INDUSTRY_LABELS[v]}
          </button>
        ))}
      </div>

      {/* 股权价值（仅上市公司显示） */}
      {listed && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">股权价值（市值）：</span>
          <input
            type="number"
            value={equityValue}
            onChange={(e) => setEquityValue(e.target.value)}
            placeholder="股价 × 股本"
            className="px-2 py-1 border border-gray-300 rounded text-sm w-56"
          />
          <span className="text-[11px] text-amber-600">
            原始 Z 的 X4 分子；缺失时用账面权益近似并标注
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-3 bg-white flex flex-col items-center">
          <ZGauge z={liveZ} model={model} zone={liveZone} />
        </div>
        <div className="border rounded-lg p-3 bg-white">
          <FactorBars factors={liveFactors} />
        </div>
      </div>

      {/* 子指标计算明细（X1–X5，详细公式 + 代入数值演算） */}
      <section className="border rounded-lg p-4 bg-gray-50">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div className="text-sm font-semibold text-gray-800">
            Altman 子指标计算明细（X1–X5）
          </div>
          <div className="text-[11px] font-mono text-gray-600">
            {Z_FORMULA[model]}
          </div>
        </div>
        <div className="text-[11px] text-gray-600 mb-3">
          子指标由财报提取引擎算出（只读）；切换公司类型/行业会改变 Z 模型与计入项（非上市非制造业 Z″ 不含 X5）。
          公式与系数严格对齐引擎（config.py）。
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {breakdowns.map((b: FactorBreakdown) => (
            <FactorDetailCard key={b.key} b={b} />
          ))}
        </div>
      </section>

      {/* 财务字段修正（抓不到时人工手填；保存后按 m6_calc 口径重算 X1–X5 与 Z） */}
      <section className="border rounded-lg p-4 bg-white">
        <div className="text-sm font-semibold text-gray-800 mb-1">财务字段修正</div>
        <div className="text-[11px] text-gray-600 mb-3">
          提取不全或数字有误时，在此手填/修正底层科目。改动项保存后将重新计算 Altman 子指标与 Z，
          并在证据表标记为「人工补录」。单位与币种一致（元）。
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {EDIT_FIELDS.map((f) => {
            const ex = fields.find((x) => x.field_key === f.key);
            const isManual = ex?.method === "manual";
            const base = ex && ex.value != null ? String(ex.value) : "";
            const edited = (fieldEdits[f.key] ?? "").trim() !== "" && fieldEdits[f.key] !== base;
            const aiSug = aiSuggestions[f.key];
            const fieldLoading = fieldAiLoading[f.key];
            const fieldMsg = fieldAiMsg[f.key];
            const isAiField = ["current_assets","current_liabilities","total_assets","total_liabilities","equity_total","retained_earnings","revenue","ebit","profit_before_tax","interest_expense"].includes(f.key);
            return (
              <div key={f.key}>
                <label className="flex items-center justify-between text-[11px] text-gray-600 mb-1">
                  <span className="flex items-center">
                    {f.label}
                    {isManual && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-300">
                        人工补录
                      </span>
                    )}
                    {aiSug && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-300">
                        AI 建议 ({aiSug.confidence.toFixed(2)})
                      </span>
                    )}
                  </span>
                  {isAiField && (
                    <button
                      onClick={() => handleAiAnalyze(f.key)}
                      disabled={fieldLoading || aiAnalyzing}
                      title="AI 分析此字段"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-300 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-wait"
                    >
                      {fieldLoading ? "⏳" : "🤖"}
                    </button>
                  )}
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={fieldEdits[f.key] ?? ""}
                    onChange={(e) =>
                      setFieldEdits((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={base ? base : "未提取，可手填或点 🤖"}
                    className={`flex-1 min-w-0 px-2 py-1 border rounded text-sm tabular-nums ${
                      aiSug ? "border-indigo-400 bg-indigo-50"
                      : edited ? "border-amber-400 bg-amber-50"
                      : "border-gray-300"
                    }`}
                  />
                </div>
                {aiSug && (
                  <div className="mt-1 flex items-start gap-1.5">
                    <div className="flex-1 min-w-0">
                      {aiSug.evidence && (
                        <div className="text-[10px] text-indigo-600/80 leading-tight">
                          💡 {aiSug.evidence.slice(0, 100)}
                        </div>
                      )}
                      {aiSug.warning && (
                        <div className="text-[10px] text-red-600 font-medium leading-tight mt-0.5">
                          ⚠ {aiSug.warning}
                        </div>
                      )}
                      <div className="flex gap-1 mt-0.5">
                        <button
                          onClick={() => acceptAiSuggestion(f.key)}
                          className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          ✓ 采纳
                        </button>
                        <button
                          onClick={() => dismissAiSuggestion(f.key)}
                          className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          ✗ 忽略
                        </button>
                        <span className="text-[10px] text-gray-400 self-center">
                          采纳=替换为{aiSug.value.toLocaleString()} · 忽略=保留原值
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {fieldMsg && !aiSug && (
                  <div className="mt-1 text-[10px] text-gray-500 leading-tight">{fieldMsg}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 风险覆盖 + 备注 + 保存 */}
      <div className="border rounded-lg p-3 bg-white space-y-3">
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">最终风险评级</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setRiskOverride("")}
              className={`px-3 py-1 rounded-md text-sm border ${
                !overridden
                  ? "bg-gray-700 text-white border-gray-700"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              跟随计算（{ZONE_LABELS[zoneOf(liveZ, model)]}）
            </button>
            {(["safe", "grey", "distress"] as RiskZone[]).map((z) => (
              <button
                key={z}
                onClick={() => setRiskOverride(z)}
                className={`px-3 py-1 rounded-md text-sm border ${
                  riskOverride === z
                    ? "text-white border-transparent"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
                style={
                  riskOverride === z
                    ? { backgroundColor: ZONE_COLORS[z] }
                    : undefined
                }
              >
                {ZONE_LABELS[z]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">人工备注</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="记录人工修正理由（如：行业判断、特殊事项）"
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
          <a
            href={`/api/runs/${runId}/export`}
            download
            className="px-4 py-1.5 rounded-md border border-green-600 text-green-700 text-sm font-medium hover:bg-green-50"
          >
            导出 Excel
          </a>
          {msg && <span className="text-xs text-gray-600">{msg}</span>}
        </div>
      </div>

      {/* 溯源字段 */}
      <div className="border rounded-lg p-3 bg-white">
        <EvidenceTable fields={fields} />
      </div>

      {/* 闸门 / 备注（原始计算信息） */}
      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-gray-600">闸门通过：</span>
          {gatesPassed.length ? (
            gatesPassed.map((g: string) => (
              <span key={g} className="text-green-700 font-medium mr-1">
                {g}
              </span>
            ))
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </div>
        <div>
          <span className="text-gray-600">闸门失败：</span>
          {gatesFailed.length ? (
            gatesFailed.map((g: string) => (
              <span key={g} className="text-red-600 font-medium mr-1">
                {g}
              </span>
            ))
          ) : (
            <span className="text-green-700">无</span>
          )}
        </div>
      </div>
      {notes.length > 0 && (
        <div className="text-xs text-amber-700">备注：{notes.join("； ")}</div>
      )}
    </div>
  );
}
