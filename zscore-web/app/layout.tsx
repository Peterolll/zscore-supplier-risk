import type { Metadata } from "next";
import Link from "next/link";
import NavTabs from "@/components/NavTabs";
import "./globals.css";

export const metadata: Metadata = {
  title: "供应商 Z-Score 风险分析",
  description: "上传财报 PDF，自动计算 Altman Z-Score 并可视化供应商信用风险",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <header className="bg-white border-b">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
            <Link href="/" className="font-bold text-blue-700 shrink-0">
              供应商 Z-Score
            </Link>
            <NavTabs />
          </div>
        </header>
        <main className="max-w-5xl mx-auto w-full px-4 py-6 flex-1">{children}</main>
        <footer className="text-center text-xs text-gray-600 py-4">
          Altman Z-Score 自动计算 · 阈值基于美国样本，跨国比较仅供参考
        </footer>
      </body>
    </html>
  );
}
