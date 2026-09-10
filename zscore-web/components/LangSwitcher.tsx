"use client";
// components/LangSwitcher.tsx — 右上角语言下拉切换器
//
// 设计要点：
// - 紧凑下拉（select 原生）：a11y 友好、键盘可用、零依赖、移动端自动调用平台 UI。
// - 显示双语 label（中文 / English）方便识别，value 存 Lang code。
// - 切换后通过 useI18n().setLang() 写 localStorage + cookie + document.documentElement.lang。

import { useI18n } from "@/lib/i18n";
import type { Lang } from "@/lib/messages";

export default function LangSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
      <span className="sr-only">{t.langSwitcher.label}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label={t.langSwitcher.label}
        className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="zh">{t.langSwitcher.zh}</option>
        <option value="en">{t.langSwitcher.en}</option>
      </select>
    </label>
  );
}