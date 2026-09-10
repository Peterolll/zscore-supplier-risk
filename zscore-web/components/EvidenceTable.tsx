import { FACTOR_LABELS } from "@/lib/constants";
import { fieldStatus } from "@/lib/zscore";

const FIELD_LABELS: Record<string, string> = {
  current_assets: "流动资产",
  current_liabilities: "流动负债",
  total_assets: "总资产",
  total_liabilities: "总负债",
  equity_total: "权益总计(账面)",
  equity_value: "股权价值(市值)",
  retained_earnings: "留存收益",
  revenue: "营业收入",
  profit_before_tax: "税前利润",
  interest_expense: "利息费用",
  ebit: "息税前利润(EBIT)",
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
  return (
    <div className="w-full">
      <div className="text-sm font-medium text-gray-700 mb-1">提取证据（科目溯源）</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="text-left p-2 border">财务字段</th>
              <th className="text-right p-2 border">数值</th>
              <th className="text-left p-2 border">命中科目</th>
              <th className="text-left p-2 border">页码</th>
              <th className="text-left p-2 border">提取方式</th>
              <th className="text-left p-2 border">确认状态</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const st = fieldStatus(f);
              return (
                <tr key={i} className="border hover:bg-gray-50">
                  <td className="p-2 border font-medium">
                    {FIELD_LABELS[f.field_key] || f.field_key}
                  </td>
                  <td className="p-2 border text-right tabular-nums">
                    {f.value == null ? "—" : f.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
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
        状态说明：<span className="text-green-700 font-medium">已确认</span>=电子文本直提；
        <span className="text-amber-700 font-medium">人工补录</span>=人工填写；
        <span className="text-amber-700 font-medium">OCR待核</span>=图片识别；
        <span className="text-amber-700 font-medium">待确认</span>=回退/推导值（如缺失小计、EBIT=税前利润假设）。
      </div>
    </div>
  );
}
