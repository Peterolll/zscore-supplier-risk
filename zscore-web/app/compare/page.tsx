import Link from "next/link";
import { getComparison } from "@/lib/db";
import CompareView from "@/components/CompareView";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const runIds = (ids || "").split(",").filter(Boolean);
  const runs = runIds.length ? getComparison(runIds) : [];

  return (
    <div className="space-y-4">
      <Link href="/suppliers" className="text-sm text-blue-600 hover:underline">
        ← 供应商库
      </Link>
      <h1 className="text-lg font-bold">多供应商对比（{runs.length}）</h1>
      {runs.length < 2 ? (
        <div className="text-sm text-gray-500 border rounded-lg p-6 text-center">
          请至少选择 2 个分析记录进行对比（在「供应商库」勾选后点「对比所选」）。
        </div>
      ) : (
        <CompareView runs={runs} />
      )}
    </div>
  );
}
