"use client";
// components/FactorDetailCard.tsx — 单张 Altman 子指标「计算明细卡」。
// 展示：含义 + 公式 + 代入实际数值的演算过程 + 系数 × 值 = 对 Z 的贡献 + 计入徽章。

import type { FactorBreakdown } from "@/lib/zscore";
import { useI18n } from "@/lib/i18n";

function fmt(n: number | null, d: number, locale: string): string {
  if (n == null) return "—";
  return n.toLocaleString(locale, { maximumFractionDigits: d });
}

export default function FactorDetailCard({ b }: { b: FactorBreakdown }) {
  const { lang, t } = useI18n();
  const cardT = t.factorCard;
  const locale = lang === "en" ? "en-US" : "zh-CN";

  const quotient =
    b.numVal != null && b.denVal != null && b.denVal !== 0
      ? b.numVal / b.denVal
      : null;
  const contribution = b.value != null ? b.coef * b.value : null;

  return (
    <div className="border rounded-lg p-3 bg-white flex flex-col">
      {/* 头部：因子 + 标签 + 计入徽章 */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-base font-bold text-blue-700">{b.key}</span>
          <span className="text-sm font-semibold text-gray-800">{b.label}</span>
        </div>
        {b.active ? (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
            {cardT.inZ}
          </span>
        ) : (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
            {cardT.notInModel}
          </span>
        )}
        {b.needsConfirmation ? (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-300">
            {cardT.needsConfirm}
          </span>
        ) : null}
      </div>

      {/* 含义 */}
      <div className="text-[11px] leading-snug text-gray-600 mb-2">
        {b.meaning}
      </div>

      {/* 演算：公式 → 代入 → 结果 */}
      <div className="bg-gray-50 rounded p-2 text-[12px] font-mono text-gray-800 space-y-1">
        <div>
          <span className="text-gray-600">{cardT.formulaLabel}</span>
          {b.key} = {b.formula}
        </div>
        <div>
          <span className="text-gray-600">{cardT.subLabel}</span>
          {b.substituted}
          {b.annualizedNote ? (
            <span className="text-amber-600">{cardT.annualized}</span>
          ) : null}
        </div>
        <div className="text-gray-600">
          <span className="text-gray-600">　　</span>
          {b.numLabel}；{b.denLabel}
        </div>
        <div className="font-semibold text-gray-900">
          <span className="text-gray-600 font-normal">{cardT.resultLabel}</span>
          {b.key} = {fmt(quotient == null ? b.value : quotient, 4, locale)}
          <span className="text-gray-600 font-normal">
            {" "}
            {cardT.storedValue(fmt(b.value, 4, locale))}
          </span>
        </div>
      </div>

      {/* 系数与对 Z 的贡献 */}
      <div className="mt-2 flex items-center justify-between text-[12px]">
        <span className="text-gray-600">
          {cardT.coefLabel} {b.coef}
          {b.active && b.value != null
            ? ` × ${fmt(b.value, 4, locale)} =`
            : b.active
            ? " × — ="
            : cardT.notCounted}
        </span>
        {b.active && (
          <span className="font-semibold text-blue-700">
            {cardT.contribution(fmt(contribution, 4, locale))}
          </span>
        )}
      </div>
    </div>
  );
}