"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export default function UploadForm() {
  const router = useRouter();
  const { lang, t } = useI18n();
  const te = t.enums;
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("manufacturing");
  const [period, setPeriod] = useState("annual");
  const [gaap, setGaap] = useState("cas");
  const [currency, setCurrency] = useState(lang === "en" ? "USD" : "CNY");
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
      setErr(t.upload.errNoFile);
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
      setErr(t.upload.errOcrUnavailable);
    } else {
      setErr(data.message || data.error || t.upload.errGeneric);
    }
  }

  const selectCls =
    "w-full border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <form onSubmit={submit} className="space-y-3 bg-white border rounded-xl p-5 shadow-sm">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.fileLabel}</label>
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
                  {t.upload.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length > 1 && (
          <div className="text-[11px] text-blue-600 mt-1">
            {t.upload.fileHint.replace("{n}", String(files.length))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.nameLabel}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.upload.namePlaceholder}
          className={selectCls}
        />
      </div>

      {/* 是否上市：决定 Z 模型（上市→原始 Altman Z，X4 用股权市值） */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.companyType}</label>
        <div className="flex gap-2">
          {([
            { k: "unlisted", label: te.unlisted },
            { k: "listed", label: te.listed },
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
        <div className="text-[11px] text-gray-600 mt-1">{t.upload.companyTypeHint}</div>
      </div>

      {/* 股权价值（仅上市公司显示） */}
      {listed && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {t.upload.equityValueLabel}
          </label>
          <input
            type="number"
            value={equityValue}
            onChange={(e) => setEquityValue(e.target.value)}
            placeholder={t.upload.equityValuePlaceholder}
            className={selectCls}
          />
          <div className="text-[11px] text-amber-600 mt-1">{t.upload.equityValueHint}</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.industry}</label>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={selectCls}>
            <option value="manufacturing">{te.manufacturing}</option>
            <option value="service">{te.service}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.period}</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={selectCls}>
            <option value="annual">{te.annual}</option>
            <option value="semi">{te.semi}</option>
            <option value="q1">{te.q1}</option>
            <option value="q2">{te.q2}</option>
            <option value="q3">{te.q3}</option>
            <option value="q4">{te.q4}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.gaap}</label>
          <select value={gaap} onChange={(e) => setGaap(e.target.value)} className={selectCls}>
            <option value="cas">{te.cas}</option>
            <option value="ifrs">{te.ifrs}</option>
            <option value="tw_gaap">{te.twGaap}</option>
            <option value="hk_gaap">{te.hkGaap}</option>
            <option value="other">{te.other}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">{t.upload.currency}</label>
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
        {loading ? t.upload.submitting : t.upload.submit}
      </button>
      <p className="text-[11px] text-gray-600">{t.upload.note}</p>
    </form>
  );
}