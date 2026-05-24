import "@/styles/globals.css";
import "katex/dist/katex.min.css";

import { type Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/core/i18n/context";
import { detectLocaleServer } from "@/core/i18n/server";

export const metadata: Metadata = {
  title: "Miaowu OS - AI 小说创作工作台",
  description:
    "Miaowu OS 是面向小说作者的 AI 创作工作台，提供作品管理、智能续写、审校修订与沉浸式阅读体验。",
  icons: {
    icon: "/brand/miaowu-logo.webp",
    shortcut: "/brand/miaowu-logo.webp",
    apple: "/brand/miaowu-logo.webp",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await detectLocaleServer();
  return (
    <html lang={locale} suppressContentEditableWarning suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          <I18nProvider initialLocale={locale}>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
