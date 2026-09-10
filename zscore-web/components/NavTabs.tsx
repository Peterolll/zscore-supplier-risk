"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "上传分析", exact: true },
  { href: "/suppliers", label: "供应商库" },
  { href: "/dictionary", label: "数据字典" },
  { href: "/manual", label: "用户手册" },
  { href: "/workflow", label: "计算工作流" },
] as const;

export default function NavTabs() {
  const pathname = usePathname();

  const isActive = (tab: (typeof TABS)[number]) =>
    "exact" in tab && tab.exact
      ? pathname === tab.href
      : pathname === tab.href || pathname.startsWith(tab.href + "/");

  return (
    <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
      {TABS.map((tab) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "text-blue-700 font-semibold border-b-2 border-blue-700 pb-0.5"
                : "hover:text-blue-700 pb-0.5 border-b-2 border-transparent"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
