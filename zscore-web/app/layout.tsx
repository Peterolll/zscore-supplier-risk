import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n";
import { HeaderShell, FooterShell } from "@/components/AppChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "供应商 Z-Score 风险分析",
  description: "上传财报 PDF，自动计算 Altman Z-Score 并可视化供应商信用风险",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <I18nProvider>
          <HeaderShell />
          <main className="max-w-5xl mx-auto w-full px-4 py-6 flex-1">{children}</main>
          <FooterShell />
        </I18nProvider>
      </body>
    </html>
  );
}