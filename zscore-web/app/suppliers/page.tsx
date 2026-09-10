import { listSuppliers } from "@/lib/db";
import SuppliersTable from "@/components/SuppliersTable";

export const dynamic = "force-dynamic";

export default function SuppliersPage() {
  const suppliers = listSuppliers();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">供应商库（{suppliers.length}）</h1>
      {suppliers.length === 0 ? (
        <div className="text-sm text-gray-500 border rounded-lg p-6 text-center bg-gray-50">
          <div className="text-3xl mb-2">📦</div>
          <div className="font-medium text-gray-700 mb-1">供应商库为空</div>
          <div className="text-xs text-gray-500">请先在首页上传财报进行分析</div>
        </div>
      ) : (
        <SuppliersTable suppliers={suppliers} />
      )}
    </div>
  );
}
