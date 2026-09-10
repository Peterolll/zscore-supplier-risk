"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { INDUSTRY_LABELS, PERIOD_LABELS, GAAP_LABELS, LISTED_LABELS } from "@/lib/constants";

export default function UploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("manufacturing");
  const [period, setPeriod] = useState("annual");
  const [gaap, setGaap] = useState("cas");
  const [currency, setCurrency] = useState("CNY");
  const [listed, setListed] = useState(false);
  const [equityValue, setEquityValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles((prev) => {
      const merged = [...prev, ...picked];
      // 默认名称取首个文件（去后缀）
      if (!name && merged.length) {
        setName(merged[0].name.replace(/\.(pdf|pptx|ppt)$/i, ""));
      }
      return merged;
    });
    e.target.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setErr("请先选择财报文件（PDF / PPTX；多张报表可一次选多张 PDF 自动合并）");
      return;
    }
    setLoading(true);
    setErr(null);
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    fd.append("name", name || files[0].name.replace(/\.(pdf|pptx|ppt)$/i, ""));
    fd.append("industry", industry);
    fd.append("period", period);
    fd.append("gaap", gaap);
    fd.append("currency", currency);
    fd.append("listed", listed ? "1" : "0");
    if (listed && equityValue) fd.append("equity_value", equityValue);

    const res = await fetch("/api/analyze", { method: "POST", body: fd });
    const data = await res.json();
    setLoading(false);

    if (data.ok) {
      router.push(`/runs/${data.runId}`);
    } else if (data.error === "OCR_UNAVAILABLE") {
      setErr("该财报为扫描件，需配置 GLM_API_KEY 启用 GLM-4V-Flash OCR 才能解析。");
    } else {
      setErr(data.message || data.error || "分析失败");
    }
  }

  const selectCls =
    "w-full border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <form onSubmit={submit} className="space-y-3 bg-white border rounded-xl p-5 shadow-sm">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">财报文件（PDF / PPTX）*</label>
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf,.pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
          onChange={onPick}
          className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs bg-gray-50 border rounded px-2 py-1">
                <span className="truncate text-gray-700">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-2 text-red-500 hover:text-red-700 shrink-0"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length > 1 && (
          <div className="text-[11px] text-blue-600 mt-1">
            已选 {files.length} 个文件，将自动合并为单份报表后提取（建议均为 PDF；PPTX 请单独上传）。
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">供应商名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="留空则取文件名"
          className={selectCls}
        />
      </div>

      {/* 是否上市：决定 Z 模型（上市→原始 Altman Z，X4 用股权市值） */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">公司类型 *</label>
        <div className="flex gap-2">
          {([
            { k: "unlisted", label: LISTED_LABELS.unlisted },
            { k: "listed", label: LISTED_LABELS.listed },
          ] as const).map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => setListed(o.k === "listed")}
              className={`flex-1 px-3 py-1.5 rounded-md text-sm border ${
                (o.k === "listed") === listed
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-gray-600 mt-1">
          上市公司 → 原始 Altman Z（5 因子，X4=股权市值÷总负债，阈值 2.675/1.81）；
          非上市公司 → Z′(制造)/Z″(非制造)，X4=账面权益÷总负债。
        </div>
      </div>

      {/* 股权价值（仅上市公司显示） */}
      {listed && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            股权价值（市值）*
          </label>
          <input
            type="number"
            value={equityValue}
            onChange={(e) => setEquityValue(e.target.value)}
            placeholder="股价 × 股本（或最近融资估值），单位与币种一致"
            className={selectCls}
          />
          <div className="text-[11px] text-amber-600 mt-1">
            原始 Z 的 X4 分子；缺失时系统会回退账面权益近似并标注。
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">行业类型 *</label>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={selectCls}>
            {Object.entries(INDUSTRY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">报告期 *</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={selectCls}>
            {Object.entries(PERIOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">会计准则 *</label>
          <select value={gaap} onChange={(e) => setGaap(e.target.value)} className={selectCls}>
            {Object.entries(GAAP_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">币种</label>
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectCls} />
        </div>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "解析与计算中…" : "上传并分析"}
      </button>
      <p className="text-[11px] text-gray-600">
        提示：公司类型与行业均由人工确认，系统不自动猜测模型。支持 PDF 与 PPTX；多张分表（如合并资产负债表+利润表+现金流量表）可一次选多张 PDF 自动合并；电子文本直接解析，扫描件需 GLM_API_KEY。
      </p>
    </form>
  );
}
