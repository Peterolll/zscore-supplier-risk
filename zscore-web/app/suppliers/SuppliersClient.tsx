"use client";
// app/suppliers/SuppliersClient.tsx — 供应商库 client 渲染层
// 拆出原因同 HomeClient：page.tsx 是 Server Component（listSuppliers 拿数据），
// 但 UI 字符串需要走 i18n。

import SuppliersTable from "@/components/SuppliersTable";
import { useI18n } from "@/lib/i18n";
import type { SupplierSummary } from "@/lib/types";

export default function SuppliersClient({ suppliers }: { suppliers: SupplierSummary[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{t.suppliersPage.title(suppliers.length)}</h1>
      {suppliers.length === 0 ? (
        <div className="text-sm text-gray-500 border rounded-lg p-6 text-center bg-gray-50">
          <div className="text-3xl mb-2">📦</div>
          <div className="font-medium text-gray-700 mb-1">{t.suppliersPage.emptyTitle}</div>
          <div className="text-xs text-gray-500">{t.suppliersPage.emptyHint}</div>
        </div>
      ) : (
        <SuppliersTable suppliers={suppliers} />
      )}
    </div>
  );
}