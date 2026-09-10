import Link from "next/link";
import { getRunDetail } from "@/lib/db";
import EditableRunDetail from "@/components/EditableRunDetail";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const detail = getRunDetail(runId);
  if (!detail) return <div className="text-gray-600">未找到该分析记录。</div>;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← 返回首页
      </Link>
      <EditableRunDetail key={`${detail.run.id}-${detail.override?.edited_at ?? ""}`} detail={detail} />
    </div>
  );
}
