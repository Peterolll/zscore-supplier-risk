"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
} from "recharts";
import { ZONE_COLORS, ZONE_LABELS, FACTOR_LABELS, Z_THRESHOLDS } from "@/lib/constants";

export default function CompareView({ runs }: { runs: any[] }) {
  const zData = runs.map((r) => ({
    name: r.supplier?.name || "?",
    z: r.run.z_score ?? 0,
    fill: ZONE_COLORS[r.run.risk_zone as keyof typeof ZONE_COLORS] || "#2563eb",
    model: r.run.model as "Z" | "Z'" | "Z''",
  }));

  // 取各供应商模型对应的安全阈值（Z=2.675 / Z'/Z''=2.9）
  const safeLines = Array.from(new Set(zData.map((d) => d.model))).map((m) => ({
    model: m,
    thr: Z_THRESHOLDS[m]?.safe ?? 2.9,
  }));

  // 因子对比表：行=X因子，列=供应商
  const factorKeys = ["X1", "X2", "X3", "X4", "X5"];
  const factorRows = factorKeys.map((k) => {
    const row: Record<string, any> = { key: k, label: FACTOR_LABELS[k] || k };
    runs.forEach((r, i) => {
      const f = r.factors.find((x: any) => x.key === k);
      row[`v${i}`] = f ? f.value : null;
    });
    return row;
  });

  return (
    <div className="space-y-5">
      <div className="border rounded-lg p-3 bg-white">
        <div className="text-sm font-medium text-gray-700 mb-1">Z-Score 对比</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={zData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(3) : String(v))} />
            {safeLines.map((s) => (
              <ReferenceLine
                key={s.model}
                y={s.thr}
                stroke="#9ca3af"
                strokeDasharray="4 4"
                label={{ value: `${s.model} 安全 ${s.thr}`, position: "insideTopRight", fontSize: 9, fill: "#9ca3af" }}
              />
            ))}
            <Bar dataKey="z" radius={[3, 3, 0, 0]}>
              {zData.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="text-[11px] text-gray-600 mt-1">
          柱色：绿=安全 / 橙=灰色区 / 红=困境；虚线=各模型安全阈值（上市 Z=2.675 / 非上市 Z′/Z″=2.9）
        </div>
      </div>

      {/* 各子指标分组对比（按供应商） */}
      <div className="border rounded-lg p-3 bg-white">
        <div className="text-sm font-medium text-gray-700 mb-2">各子指标分组对比（按供应商）</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {["X1", "X2", "X3", "X4", "X5"].map((k) => {
            const data = runs.map((r, i) => {
              const f = r.factors.find((x: any) => x.key === k);
              return {
                name: r.supplier?.name || `S${i + 1}`,
                value: f && f.value != null ? f.value : 0,
                fill: ZONE_COLORS[r.run.risk_zone as keyof typeof ZONE_COLORS] || "#2563eb",
              };
            });
            return (
              <div key={k} className="border rounded-lg p-2 bg-white">
                <div className="text-xs font-medium text-gray-600 mb-1">
                  {FACTOR_LABELS[k] || k}
                </div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                      height={42}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={36} />
                    <Tooltip
                      formatter={(v) => (typeof v === "number" ? v.toFixed(4) : String(v))}
                    />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                      {data.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
        <div className="text-[11px] text-gray-600 mt-1">
          柱色：绿=安全 / 橙=灰色区 / 红=困境。上市原始 Z 与非上市 Z′ 含 X5；非上市非制造业 Z″ 不含 X5（展示但不参与计算）。
        </div>
      </div>

      <div className="border rounded-lg p-3 bg-white overflow-x-auto">
        <div className="text-sm font-medium text-gray-700 mb-1">因子明细对比</div>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600">
              <th className="text-left p-2 border">因子</th>
              {runs.map((r, i) => (
                <th key={i} className="text-right p-2 border">
                  {r.supplier?.name}
                  <div className="font-normal text-gray-600">
                    {r.run.model} · {ZONE_LABELS[r.run.risk_zone as keyof typeof ZONE_LABELS]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {factorRows.map((row) => (
              <tr key={row.key} className="border hover:bg-gray-50">
                <td className="p-2 border font-medium">{row.label}</td>
                {runs.map((_, i) => (
                  <td key={i} className="p-2 border text-right tabular-nums">
                    {row[`v${i}`] == null ? "—" : (row[`v${i}`] as number).toFixed(4)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
