import Link from "next/link";
import UploadForm from "@/components/UploadForm";
import { listSuppliers } from "@/lib/db";
import RiskBadge from "@/components/RiskBadge";
import { ZONE_COLORS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default function Home() {
  const suppliers = listSuppliers();

  return (
    <div className="grid md:grid-cols-[380px_1fr] gap-6">
      <div>
        <h1 className="text-lg font-bold mb-3">上传财报并分析</h1>
        <UploadForm />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">最近分析</h2>
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-sm text-indigo-600 hover:underline">
              ⚙ 设置
            </Link>
            <Link href="/suppliers" className="text-sm text-blue-600 hover:underline">
              查看全部 →
            </Link>
          </div>
        </div>
        {suppliers.length === 0 ? (
          <div className="text-sm text-gray-500 border rounded-lg p-6 text-center bg-gray-50">
            <div className="text-3xl mb-2">📊</div>
            <div className="font-medium text-gray-700 mb-1">还没有分析记录</div>
            <div className="text-xs text-gray-500">从左侧上传一份财报 PDF 或 PPTX 开始分析</div>
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
