import ZGauge from "./ZGauge";
import FactorBars from "./FactorBars";
import EvidenceTable from "./EvidenceTable";
import RiskBadge from "./RiskBadge";
import { INDUSTRY_LABELS, PERIOD_LABELS, GAAP_LABELS } from "@/lib/constants";

export default function RunDetail({ detail }: { detail: any }) {
  const { run, factors, fields, supplier } = detail;
  const gatesPassed = (run.gates_passed || "").split(",").filter(Boolean);
  const gatesFailed = (run.gates_failed || "").split(",").filter(Boolean);
  const notes = (run.notes || "").split(",").filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{supplier?.name}</h2>
        <RiskBadge zone={run.risk_zone} />
        <span className="text-xs text-gray-600">
          {run.model} · {run.method}
          {run.annualized ? ` · 流量年化×${run.annualize_factor}` : ""} ·{" "}
          {run.created_at}
        </span>
      </div>
      <div className="text-xs text-gray-600">
        {INDUSTRY_LABELS[supplier?.industry]} · {PERIOD_LABELS[supplier?.period]} ·{" "}
        {GAAP_LABELS[supplier?.gaap]} · {supplier?.currency}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-3 bg-white">
          <ZGauge z={run.z_score} model={run.model} zone={run.risk_zone} />
        </div>
        <div className="border rounded-lg p-3 bg-white">
          <FactorBars factors={factors} />
        </div>
      </div>

      <div className="border rounded-lg p-3 bg-white">
        <EvidenceTable fields={fields} />
      </div>

      <div className="flex flex-wrap gap-6 text-xs">
        <div>
          <span className="text-gray-600">闸门通过：</span>
          {gatesPassed.length ? (
            gatesPassed.map((g: string) => (
              <span key={g} className="text-green-700 font-medium mr-1">
                {g}
              </span>
            ))
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </div>
        <div>
          <span className="text-gray-600">闸门失败：</span>
          {gatesFailed.length ? (
            gatesFailed.map((g: string) => (
              <span key={g} className="text-red-600 font-medium mr-1">
                {g}
              </span>
            ))
          ) : (
            <span className="text-green-700">无</span>
          )}
        </div>
      </div>

      {notes.length > 0 && (
        <div className="text-xs text-amber-700">备注：{notes.join("； ")}</div>
      )}
    </div>
  );
}
