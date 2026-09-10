"use client";
// components/AppChrome.tsx — 含 LangSwitcher + useT 的 client 壳
// 拆分原因：layout.tsx 是 Server Component，不能直接调 useT()。

import Link from "next/link";
import NavTabs from "./NavTabs";
import LangSwitcher from "./LangSwitcher";
import { useT } from "@/lib/i18n";

export function HeaderShell() {
  const t = useT();
  return (
    <header className="bg-white border-b">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-bold text-blue-700 shrink-0">
          {t.brand.shortTitle}
        </Link>
        <NavTabs />
        <div className="ml-auto">
          <LangSwitcher />
        </div>
      </div>
    </header>
  );
}

export function FooterShell() {
  const t = useT();
  return (
    <footer className="text-center text-xs text-gray-600 py-4">
      {t.brand.footer}
    </footer>
  );
}