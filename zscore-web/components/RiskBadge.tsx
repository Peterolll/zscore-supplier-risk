"use client";
import { ZONE_COLORS } from "@/lib/constants";
import { useT } from "@/lib/i18n";
import type { RiskZone } from "@/lib/types";

export default function RiskBadge({ zone }: { zone: RiskZone }) {
  const t = useT();
  const c = ZONE_COLORS[zone];
  const label = t.zones[zone];
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold border"
      style={{ backgroundColor: c + "1a", color: c, borderColor: c }}
    >
      {label}
    </span>
  );
}