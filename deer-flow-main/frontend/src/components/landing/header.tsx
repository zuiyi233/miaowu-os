import { LibraryIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/core/i18n/locale";
import { getI18n } from "@/core/i18n/server";
import { cn } from "@/lib/utils";

export type HeaderProps = {
  className?: string;
  homeURL?: string;
  locale?: Locale;
};

export async function Header({ className, homeURL, locale }: HeaderProps) {
  const { t } = await getI18n(locale);
  return (
    <header
      className={cn(
        "container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between backdrop-blur-xs",
        className,
      )}
    >
      <div className="flex items-center gap-6">
        <Link href={homeURL ?? "/"}>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <img
              src="/brand/miaowu-logo.webp"
              alt="Miaowu OS"
              className="size-8 rounded-lg object-cover"
            />
            <span className="bg-linear-to-r from-amber-300 via-orange-300 to-amber-400 bg-clip-text text-transparent">
              Miaowu OS
            </span>
          </h1>
        </Link>
      </div>
      <nav className="mr-8 ml-auto flex items-center gap-8 text-sm font-medium">
        <Link
          href="/workspace/novel"
          prefetch={false}
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          {t.sidebar.novel}
        </Link>
        <Link
          href="/workspace/novel/author-control"
          prefetch={false}
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          作者控制台
        </Link>
      </nav>
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 z-0 h-full w-full rounded-full opacity-30 blur-2xl"
          style={{
            background: "linear-gradient(90deg, #f59e0b 0%, #ec4899 100%)",
            filter: "blur(16px)",
          }}
        />
        <Button
          variant="outline"
          size="sm"
          asChild
          className="group relative z-10"
        >
          <Link href="/workspace/novel" prefetch={false}>
            <LibraryIcon className="size-4" />
            我的书架
          </Link>
        </Button>
      </div>
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}
