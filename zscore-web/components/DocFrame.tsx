"use client";

import { useCallback, useRef, useState } from "react";

/**
 * DocFrame — 同源静态文档（public/*.html）自适应高度 iframe。
 * onLoad 后读取内容文档高度，避免双层滚动条。
 * 用于"用户手册 / 计算工作流"两个只读文档页。
 */
export default function DocFrame({
  src,
  title,
  minHeight = 520,
}: {
  src: string;
  title: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [ready, setReady] = useState(false);

  const onLoad = useCallback(() => {
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.documentElement) {
        const h = doc.documentElement.scrollHeight;
        if (h > 0) setHeight(Math.max(h, minHeight));
      }
    } catch {
      // 跨域或安全限制时保持 minHeight（页面内自带滚动）
    }
    setReady(true);
  }, [minHeight]);

  return (
    <div className="w-full">
      <iframe
        ref={ref}
        src={src}
        title={title}
        onLoad={onLoad}
        className="w-full border-0 rounded-lg bg-white shadow-sm transition-opacity"
        style={{ height, opacity: ready ? 1 : 0.4 }}
      />
    </div>
  );
}
