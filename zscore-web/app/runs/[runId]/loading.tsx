// app/runs/[runId]/loading.tsx — 运行详情页骨架屏

export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-24" />
      <div className="h-8 bg-gray-200 rounded w-64" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="h-48 bg-gray-100 rounded-lg border border-gray-200" />
        <div className="h-48 bg-gray-100 rounded-lg border border-gray-200" />
      </div>
      <div className="h-64 bg-gray-100 rounded-lg border border-gray-200" />
      <div className="h-48 bg-gray-100 rounded-lg border border-gray-200" />
    </div>
  );
}
