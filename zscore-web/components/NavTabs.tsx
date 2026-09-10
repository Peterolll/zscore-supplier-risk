"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";

export default function NavTabs() {
  const pathname = usePathname();
  const t = useT();

  const TABS = [
    { href: "/", label: t.nav.upload, exact: true },
    { href: "/suppliers", label: t.nav.suppliers },
    { href: "/dictionary", label: t.nav.dictionary },
    { href: "/manual", label: t.nav.manual },
    { href: "/workflow", label: t.nav.workflow },
  ] as const;

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