import Link from "next/link";
import { getSupplierWithRuns, getRunDetail } from "@/lib/db";
import EditableRunDetail from "@/components/EditableRunDetail";
import RiskBadge from "@/components/RiskBadge";
import SupplierDeleteButton from "@/components/SupplierDeleteButton";
import { ZONE_COLORS, INDUSTRY_LABELS, PERIOD_LABELS, GAAP_LABELS, LISTED_LABELS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = getSupplierWithRuns(id);
  if (!data) return <div className="text-gray-600">未找到该供应商。</div>;

  const { supplier, runs } = data;
  const latest = runs[0];
  const latestDetail = latest ? getRunDetail(latest.id) : null;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/suppliers" className="text-sm text-blue-600 hover:underline">
          ← 供应商库
        </Link>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{supplier.name}</h1>
          <div className="text-xs text-gray-600 mt-1">
            {runs.length} 次分析记录 · 创建于 {supplier.created_at}
          </div>
        </div>
        <SupplierDeleteButton supplierId={supplier.id} supplierName={supplier.name} />
      </div>

      <div className="border rounded-xl p-4 bg-gray-50 grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-sm">
        <Field label="行业分类" value={INDUSTRY_LABELS[supplier.industry]} />
        <Field
          label="上市状态"
          value={LISTED_LABELS[supplier.listed === 1 ? "listed" : "unlisted"]}
        />
        <Field
          label="股权市值"
          value={
            supplier.equity_value == null
              ? "—"
              : supplier.equity_value.toLocaleString("zh-CN")
          }
        />
        <Field label="会计准则" value={GAAP_LABELS[supplier.gaap]} />
        <Field label="报告期" value={PERIOD_LABELS[supplier.period]} />
        <Field label="币种" value={supplier.currency} />
      </div>

      {latestDetail && (
        <div className="border rounded-xl p-4">
          <div className="text-sm font-semibold mb-1">最新分析（{latest.created_at}）</div>
          <div className="text-xs text-gray-500 mb-2">
            如需修改行业分类 / 上市状态 / 股权市值，请在下方面板调整，将同步至该供应商全部历史记录。
          </div>
          <EditableRunDetail
            key={`${latest.id}-${latestDetail.override?.edited_at ?? ""}`}
            detail={latestDetail}
          />
        </div>
      )}

      <div>
        <div className="text-sm font-semibold mb-2">历史记录</div>
        <div className="space-y-1">
          {runs.map((r) => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="flex items-center justify-between border rounded-md px-3 py-2 bg-white text-sm hover:bg-gray-50"
            >
              <span className="text-gray-600">{r.created_at}</span>
              <span
                className="font-semibold"
                style={{ color: ZONE_COLORS[r.risk_zone as keyof typeof ZONE_COLORS] }}
              >
                {r.z_score == null ? "—" : r.z_score.toFixed(2)}
              </span>
              <RiskBadge zone={r.risk_zone as any} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
