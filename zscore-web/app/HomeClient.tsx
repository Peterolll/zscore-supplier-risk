"use client";
// app/HomeClient.tsx — 首页 client 渲染层
// 拆出原因：app/page.tsx 是 Server Component（需要 listSuppliers() 拿数据），
// 但 UI 字符串需要走 i18n（client hook useT）。

import Link from "next/link";
import UploadForm from "@/components/UploadForm";
import RiskBadge from "@/components/RiskBadge";
import { ZONE_COLORS } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import type { SupplierSummary } from "@/lib/types";

export default function HomeClient({ suppliers }: { suppliers: SupplierSummary[] }) {
  const { t } = useI18n();
  return (
    <div className="grid md:grid-cols-[380px_1fr] gap-6">
      <div>
        <h1 className="text-lg font-bold mb-3">{t.homepage.uploadTitle}</h1>
        <UploadForm />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">{t.homepage.recentTitle}</h2>
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-sm text-indigo-600 hover:underline">
              {t.homepage.settings}
            </Link>
            <Link href="/suppliers" className="text-sm text-blue-600 hover:underline">
              {t.homepage.viewAll}
            </Link>
          </div>
        </div>
        {suppliers.length === 0 ? (
          <div className="text-sm text-gray-500 border rounded-lg p-6 text-center bg-gray-50">
            <div className="text-3xl mb-2">📊</div>
            <div className="font-medium text-gray-700 mb-1">{t.homepage.emptyTitle}</div>
            <div className="text-xs text-gray-500">{t.homepage.emptyHint}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {suppliers.map((s) => (
              <Link
                key={s.runId}
                href={`/runs/${s.runId}`}
                className="block border rounded-lg p-3 bg-white hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <RiskBadge zone={s.riskZone} />
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  {s.model} · Z ={" "}
                  <span style={{ color: ZONE_COLORS[s.riskZone] }} className="font-semibold">
                    {s.zScore == null ? "—" : s.zScore.toFixed(2)}
                  </span>{" "}
                  · {s.period} · {s.method} · {s.runAt}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}