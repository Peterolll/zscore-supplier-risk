import type { Metadata } from "next";
import DocFrame from "@/components/DocFrame";

export const metadata: Metadata = {
  title: "用户手册 · 供应商 Z-Score",
};

export default function ManualPage() {
  return (
    <div className="space-y-2">
      <DocFrame
        src="/manual.html"
        title="供应商 Z-Score 用户手册"
        minHeight={640}
      />
    </div>
  );
}
