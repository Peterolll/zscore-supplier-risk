"use client";
import type { ZModel, RiskZone } from "@/lib/types";
import { Z_THRESHOLDS, ZONE_COLORS, ZONE_LABELS } from "@/lib/constants";

const MIN = -2;
const MAX = 10;

function tOf(v: number) {
  return Math.max(0, Math.min(1, (v - MIN) / (MAX - MIN)));
}
function pt(t: number, r = 80) {
  const a = Math.PI * (1 - t);
  return [100 + r * Math.cos(a), 100 - r * Math.sin(a)] as const;
}
function arc(t0: number, t1: number, r = 80) {
  const [x0, y0] = pt(t0, r);
  const [x1, y1] = pt(t1, r);
  const large = 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export default function ZGauge({
  z,
  model,
  zone,
}: {
  z: number | null;
  model: ZModel;
  zone: RiskZone;
}) {
  const hasZ = z != null;
  const val = z ?? 0;
  const thr = Z_THRESHOLDS[model];
  const color = ZONE_COLORS[zone];
  const vt = tOf(val);

  const greyT = tOf(thr.grey);
  const safeT = tOf(thr.safe);

  const [gx0, gy0] = pt(greyT, 80 - 9);
  const [gx1, gy1] = pt(greyT, 80 + 9);
  const [sx0, sy0] = pt(safeT, 80 - 9);
  const [sx1, sy1] = pt(safeT, 80 + 9);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-56">
        {/* 背景弧 */}
        <path d={arc(0, 1)} fill="none" stroke="#e5e7eb" strokeWidth={14} strokeLinecap="round" />
        {/* 数值弧：Z 不可计算时不画，避免指针停在 0 造成"高风险"错觉 */}
        {hasZ && (
          <path d={arc(0, vt)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
        )}
        {/* 阈值刻度 */}
        <line x1={gx0} y1={gy0} x2={gx1} y2={gy1} stroke="#6b7280" strokeWidth={2} />
        <line x1={sx0} y1={sy0} x2={sx1} y2={sy1} stroke="#6b7280" strokeWidth={2} />
        {/* 中心数值 */}
        <text x={100} y={92} textAnchor="middle" fontSize={30} fontWeight={700} fill={color}>
          {hasZ ? val.toFixed(2) : "—"}
        </text>
        <text x={100} y={108} textAnchor="middle" fontSize={11} fill="#4b5563">
          {model} · {ZONE_LABELS[zone]}
        </text>
      </svg>
      <div className="text-xs text-gray-600 -mt-1">
        阈值 灰线={thr.grey} · 安全线={thr.safe}（Altman 美国样本参考）
      </div>
    </div>
  );
}
