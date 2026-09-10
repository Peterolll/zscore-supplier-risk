"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import RiskBadge from "./RiskBadge";
import ConfirmDialog from "./ConfirmDialog";
import { ZONE_COLORS } from "@/lib/constants";
import { useI18n } from "@/lib/i18n";
import type { SupplierSummary } from "@/lib/types";

export default function SuppliersTable({ suppliers }: { suppliers: SupplierSummary[] }) {
  const { t } = useI18n();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; name?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function toggle(id: string) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function askDeleteOne(id: string, name: string) {
    setConfirm({ ids: [id], name });
  }
  function askDeleteMany() {
    if (sel.size === 0) return;
    setConfirm({ ids: [...sel] });
  }

  async function doDelete() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.ids.length === 1) {
        await fetch(`/api/suppliers/${confirm.ids[0]}`, { method: "DELETE" });
      } else {
        await fetch(`/api/suppliers`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: confirm.ids }),
        });
      }
      setSel(new Set());
      setConfirm(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function compare() {
    if (sel.size < 2) return;
    const ids = suppliers.filter((s) => sel.has(s.id)).map((s) => s.runId);
    router.push(`/compare?ids=${ids.join(",")}`);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-600">{t.suppliersTable.selected(sel.size)}</span>
        <div className="flex gap-2">
          <button
            onClick={askDeleteMany}
            disabled={sel.size === 0}
            className="text-sm bg-red-600 text-white px-3 py-1.5 rounded-md disabled:opacity-40 hover:bg-red-700"
          >
            {t.suppliersTable.batchDelete(sel.size)}
          </button>
          <button
            onClick={compare}
            disabled={sel.size < 2}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md disabled:opacity-40 hover:bg-blue-700"
          >
            {t.suppliersTable.compareSelected}
          </button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="p-2 w-8"></th>
              <th className="text-left p-2">{t.suppliersTable.columns.supplier}</th>
              <th className="text-left p-2">{t.suppliersTable.columns.industryGaap}</th>
              <th className="text-left p-2">{t.suppliersTable.columns.model}</th>
              <th className="text-right p-2">{t.suppliersTable.columns.zScore}</th>
              <th className="text-left p-2">{t.suppliersTable.columns.risk}</th>
              <th className="text-left p-2">{t.suppliersTable.columns.method}</th>
              <th className="text-right p-2 w-16">{t.suppliersTable.columns.action}</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="border-t hover:bg-gray-50">
                <td className="p-2 text-center">
                  <input
                    type="checkbox"
                    checked={sel.has(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                </td>
                <td className="p-2">
                  <Link href={`/suppliers/${s.id}`} className="font-medium text-blue-700 hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="p-2 text-xs text-gray-600">
                  {s.industry} · {s.gaap}
                </td>
                <td className="p-2 text-xs">{s.model}</td>
                <td
                  className="p-2 text-right font-semibold tabular-nums"
                  style={{ color: ZONE_COLORS[s.riskZone] }}
                >
                  {s.zScore == null ? "—" : s.zScore.toFixed(2)}
                </td>
                <td className="p-2">
                  <RiskBadge zone={s.riskZone} />
                </td>
                <td className="p-2 text-xs text-gray-600">{s.method}</td>
                <td className="p-2 text-right">
                  <button
                    onClick={() => askDeleteOne(s.id, s.name)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {t.suppliersTable.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirm != null}
        title={confirm && confirm.ids.length > 1 ? t.confirm.batchTitle : t.confirm.oneTitle}
        message={
          confirm
            ? confirm.ids.length > 1
              ? t.confirm.batchMsg(confirm.ids.length)
              : t.confirm.oneMsg(confirm.name ?? "")
            : ""
        }
        confirmText={busy ? t.confirm.busy : t.confirm.confirm}
        onConfirm={doDelete}
        onCancel={() => !busy && setConfirm(null)}
      />
    </div>
  );
}