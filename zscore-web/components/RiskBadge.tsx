import { ZONE_COLORS, ZONE_LABELS } from "@/lib/constants";
import type { RiskZone } from "@/lib/types";

export default function RiskBadge({ zone }: { zone: RiskZone }) {
  const c = ZONE_COLORS[zone];
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold border"
      style={{ backgroundColor: c + "1a", color: c, borderColor: c }}
    >
      {ZONE_LABELS[zone]}
    </span>
  );
}
