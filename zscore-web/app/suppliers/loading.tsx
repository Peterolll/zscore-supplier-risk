// app/suppliers/loading.tsx — 供应商库骨架屏

export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-7 bg-gray-200 rounded w-40" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 bg-gray-100 rounded-lg border border-gray-200" />
        ))}
      </div>
    </div>
  );
}
