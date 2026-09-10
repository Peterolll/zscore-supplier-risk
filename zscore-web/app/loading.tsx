// app/loading.tsx — 首页骨架屏

export default function Loading() {
  return (
    <div className="grid md:grid-cols-[380px_1fr] gap-6 animate-pulse">
      <div>
        <div className="h-7 bg-gray-200 rounded w-48 mb-3" />
        <div className="h-48 bg-gray-100 rounded-lg border border-gray-200" />
      </div>
      <div>
        <div className="h-7 bg-gray-200 rounded w-32 mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg border border-gray-200" />
          ))}
        </div>
      </div>
    </div>
  );
}
