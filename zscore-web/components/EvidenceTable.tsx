"use client";
import { FACTOR_LABELS } from "@/lib/constants";
import { fieldStatus } from "@/lib/zscore";
import { useI18n } from "@/lib/i18n";

const FIELD_LABELS: Record<string, string> = {
  current_assets: "流动资产 / Current Assets",
  current_liabilities: "流动负债 / Current Liabilities",
  total_assets: "总资产 / Total Assets",
  total_liabilities: "总负债 / Total Liabilities",
  equity_total: "权益总计(账面) / Book Equity",
  equity_value: "股权价值(市值) / Market Cap",
  retained_earnings: "留存收益 / Retained Earnings",
  revenue: "营业收入 / Revenue",
  profit_before_tax: "税前利润 / PBT",
  interest_expense: "利息费用 / Interest Expense",
  ebit: "息税前利润(EBIT) / EBIT",
};

export default function EvidenceTable({
  fields,
}: {
  fields: {
    field_key: string;
    value: number | null;
    evidence: string;
    source_page: number | null;
    method: string;
    confidence: number;
  }[];
}) {
  const { lang, t } = useI18n();
  const fs = t.fieldStatus;
  const numLocale = lang === "en" ? "en-US" : "zh-CN";
  return (
    <div className="w-full">
      <div className="text-sm font-medium text-gray-700 mb-1">提取证据（科目溯源）</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="text-left p-2 border">财务字段 / Field</th>
              <th className="text-right p-2 border">数值 / Value</th>
              <th className="text-left p-2 border">命中科目 / Matched Item</th>
              <th className="text-left p-2 border">页码 / Page</th>
              <th className="text-left p-2 border">提取方式 / Method</th>
              <th className="text-left p-2 border">确认状态 / Status</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const st = fieldStatus(f, t);
              return (
                <tr key={i} className="border hover:bg-gray-50">
                  <td className="p-2 border font-medium">
                    {FIELD_LABELS[f.field_key] || f.field_key}
                  </td>
                  <td className="p-2 border text-right tabular-nums">
                    {f.value == null
                      ? "—"
                      : f.value.toLocaleString(numLocale, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="p-2 border text-gray-600">{f.evidence || "—"}</td>
                  <td className="p-2 border">{f.source_page ?? "—"}</td>
                  <td className="p-2 border text-gray-600">{f.method}</td>
                  <td className="p-2 border">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                        st.tone === "ok"
                          ? "bg-green-50 text-green-700 border-green-200"
                          : "bg-amber-50 text-amber-700 border-amber-300"
                      }`}
                    >
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-gray-600 mt-2">
        状态说明 / Status:{" "}
        <span className="text-green-700 font-medium">{fs.confirmed}</span>=电子文本直提 / Electronic text direct hit;{" "}
        <span className="text-amber-700 font-medium">{fs.manual}</span>=人工填写 / Manual entry;{" "}
        <span className="text-amber-700 font-medium">{fs.ocrPending}</span>=图片识别 / OCR;{" "}
        <span className="text-amber-700 font-medium">{fs.pending}</span>=回退/推导值 / Fallback/derived (e.g. missing subtotal, EBIT=PBT assumption).
      </div>
    </div>
  );
}