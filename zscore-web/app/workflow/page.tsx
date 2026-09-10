import type { Metadata } from "next";
import DocFrame from "@/components/DocFrame";

export const metadata: Metadata = {
  title: "计算工作流 · 供应商 Z-Score",
};

export default function WorkflowPage() {
  return (
    <div className="space-y-2">
      <DocFrame
        src="/workflow.html"
        title="供应商 Z-Score 计算工作流图"
        minHeight={720}
      />
    </div>
  );
}
