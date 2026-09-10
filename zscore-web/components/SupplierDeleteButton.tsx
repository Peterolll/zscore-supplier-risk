"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "./ConfirmDialog";

export default function SupplierDeleteButton({
  supplierId,
  supplierName,
}: {
  supplierId: string;
  supplierName: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function doDelete() {
    setBusy(true);
    try {
      await fetch(`/api/suppliers/${supplierId}`, { method: "DELETE" });
      router.push("/suppliers");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirm(true)}
        className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-md hover:bg-red-700 whitespace-nowrap"
      >
        删除此供应商
      </button>
      <ConfirmDialog
        open={confirm}
        title="删除供应商"
        message={`确认删除供应商「${supplierName}」？其全部历史分析记录（含因子与财务字段）将一并清除，且不可恢复。`}
        confirmText={busy ? "删除中…" : "确认删除"}
        onConfirm={doDelete}
        onCancel={() => !busy && setConfirm(false)}
      />
    </>
  );
}
