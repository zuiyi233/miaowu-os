"use client";

import {
  BookOpenTextIcon,
  ClipboardCheckIcon,
  FileInputIcon,
  PenLineIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AuroraText } from "../ui/aurora-text";

let waved = false;

const authorActions = [
  {
    href: "/workspace/novel",
    icon: BookOpenTextIcon,
    label: "小说工作室",
    description: "作品、章节、角色、设定",
  },
  {
    href: "/workspace/novel/inspiration",
    icon: SparklesIcon,
    label: "灵感模式",
    description: "情节转折、场景、对白",
  },
  {
    href: "/workspace/novel/book-import",
    icon: FileInputIcon,
    label: "拆书导入",
    description: "导入长文并结构化",
  },
  {
    href: "/workspace/novel",
    icon: ClipboardCheckIcon,
    label: "作者控制台",
    description: "先选择作品后进入闭环",
  },
];

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isUltra = useMemo(() => mode === "ultra", [mode]);
  const colors = useMemo(() => {
    if (isUltra) {
      return ["#efefbb", "#e9c665", "#e3a812"];
    }
    return ["var(--color-foreground)"];
  }, [isUltra]);
  useEffect(() => {
    waved = true;
  }, []);
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-3 px-8 py-4 text-center",
        className,
      )}
    >
      {searchParams.get("mode") !== "skill" && (
        <div className="mb-1 flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-xs font-medium text-amber-300">
          <PenLineIcon className="size-3.5" />
          Miaowu Author Workspace
        </div>
      )}
      <div className="text-2xl font-bold">
        {searchParams.get("mode") === "skill" ? (
          `✨ ${t.welcome.createYourOwnSkill} ✨`
        ) : (
          <div className="flex items-center gap-2">
            <div className={cn("inline-block", !waved ? "animate-wave" : "")}>
              {isUltra ? "🚀" : "👋"}
            </div>
            <AuroraText colors={colors}>{t.welcome.greeting}</AuroraText>
          </div>
        )}
      </div>
      {searchParams.get("mode") === "skill" ? (
        <div className="text-muted-foreground text-sm">
          {t.welcome.createYourOwnSkillDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.createYourOwnSkillDescription}
            </pre>
          ) : (
            <p>{t.welcome.createYourOwnSkillDescription}</p>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">
          {t.welcome.description.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.description}
            </pre>
          ) : (
            <p>{t.welcome.description}</p>
          )}
        </div>
      )}
      {searchParams.get("mode") !== "skill" && (
        <div className="pointer-events-auto mt-2 grid w-full max-w-3xl grid-cols-2 gap-2 text-left md:grid-cols-4">
          {authorActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.label}
                href={action.href}
                className="group rounded-lg border border-border/60 bg-background/60 px-3 py-2 shadow-sm backdrop-blur transition hover:border-amber-500/35 hover:bg-amber-500/5"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-amber-400" />
                  <span className="truncate">{action.label}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {action.description}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
