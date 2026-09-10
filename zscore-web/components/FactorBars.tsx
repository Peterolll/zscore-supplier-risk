"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { FACTOR_LABELS } from "@/lib/constants";

export default function FactorBars({
  factors,
}: {
  factors: { key: string; value: number | null }[];
}) {
  const data = factors.map((f) => ({
    name: FACTOR_LABELS[f.key] || f.key,
    value: f.value ?? 0,
  }));
  return (
    <div className="w-full">
      <div className="text-sm font-medium text-gray-700 mb-1">Altman 因子分解</div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 42)}>
        <BarChart layout="vertical" data={data} margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(4) : String(v))} />
          <ReferenceLine x={0} stroke="#9ca3af" />
          <Bar dataKey="value" fill="#2563eb" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
