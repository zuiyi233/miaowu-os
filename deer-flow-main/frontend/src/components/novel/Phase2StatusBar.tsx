"use client";

import { AlertCircle, CheckCircle2, Clock3, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Phase2StatusSnapshot } from "@/core/novel/phase2-status";
import { cn } from "@/lib/utils";

type StatusMeta = {
  label: string;
  icon: ReactNode;
  badgeClass: string;
};

const statusMeta: Record<Phase2StatusSnapshot["status"], StatusMeta> = {
  idle: {
    label: "待检查",
    icon: <Clock3 className="h-4 w-4" />,
    badgeClass: "bg-muted text-muted-foreground",
  },
  pending: {
    label: "排队中",
    icon: <Clock3 className="h-4 w-4" />,
    badgeClass: "bg-muted text-muted-foreground",
  },
  running: {
    label: "执行中",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    badgeClass: "bg-blue-100 text-blue-700",
  },
  success: {
    label: "已通过",
    icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    badgeClass: "bg-green-100 text-green-700",
  },
  warning: {
    label: "有风险",
    icon: <AlertCircle className="h-4 w-4 text-amber-600" />,
    badgeClass: "bg-amber-100 text-amber-700",
  },
  blocked: {
    label: "已阻断",
    icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
    badgeClass: "bg-red-100 text-red-700",
  },
  failed: {
    label: "失败",
    icon: <AlertCircle className="h-4 w-4 text-destructive" />,
    badgeClass: "bg-red-100 text-red-700",
  },
};

interface Phase2StatusBarProps {
  snapshot: Phase2StatusSnapshot | null;
  reportHref?: string;
  className?: string;
  compact?: boolean;
  emptyText?: string;
}

function formatProgress(progress?: number): string | null {
  if (progress === undefined || Number.isNaN(progress)) {
    return null;
  }
  const normalized = Math.max(0, Math.min(100, progress));
  return `${Math.round(normalized)}%`;
}

export function Phase2StatusBar({
  snapshot,
  reportHref,
  className,
  compact = false,
  emptyText,
}: Phase2StatusBarProps) {
  if (!snapshot && !emptyText) {
    return null;
  }

  if (!snapshot && emptyText) {
    return (
      <Alert className={cn("py-2", className)}>
        <Clock3 className="h-4 w-4" />
        <AlertTitle>阶段二状态</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{emptyText}</span>
          {reportHref ? (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Link href={reportHref}>查看一致性报告</Link>
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  const meta = statusMeta[snapshot!.status];
  const progressText = formatProgress(snapshot!.progress);
  const blockerList = compact ? snapshot!.blockers.slice(0, 2) : snapshot!.blockers;
  const errorList = compact
    ? snapshot!.errors.slice(0, 2)
    : snapshot!.errors.slice(0, 4);
  const warningItems = snapshot!.warnings ?? [];
  const warningList = compact
    ? warningItems.slice(0, 2)
    : warningItems.slice(0, 4);
  const variant =
    snapshot!.status === "blocked" || snapshot!.status === "failed"
      ? "destructive"
      : "default";

  return (
    <Alert className={cn("py-2", className)} variant={variant}>
      {meta.icon}
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>阶段二任务状态</span>
        <Badge className={cn("font-normal", meta.badgeClass)}>{meta.label}</Badge>
        {snapshot!.stage ? (
          <Badge variant="outline" className="font-normal">
            {snapshot!.stage}
          </Badge>
        ) : null}
        {progressText ? (
          <Badge variant="outline" className="font-normal">
            {progressText}
          </Badge>
        ) : null}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span>{snapshot!.message ?? "状态已同步，等待下一步处理。"}</span>
          {reportHref ? (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Link href={reportHref}>查看一致性报告</Link>
            </Button>
          ) : null}
        </div>

        {blockerList.length > 0 ? (
          <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
            <div className="text-xs font-medium text-destructive">定稿门禁阻断项</div>
            {blockerList.map((blocker, index) => (
              <div key={`${blocker.code ?? "blocker"}-${index}`} className="text-xs">
                <span className="font-medium">
                  {blocker.code ? `${blocker.code}: ` : ""}
                </span>
                <span>{blocker.message}</span>
                {blocker.location ? (
                  <span className="text-muted-foreground">（{blocker.location}）</span>
                ) : null}
                {blocker.hint ? (
                  <div className="text-muted-foreground">建议：{blocker.hint}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {errorList.length > 0 && blockerList.length === 0 ? (
          <div className="space-y-1 rounded-md border border-border/70 bg-muted/30 p-2">
            <div className="text-xs font-medium">关键错误</div>
            {errorList.map((error, index) => (
              <div key={`${error.code ?? "error"}-${index}`} className="text-xs">
                <span className="font-medium">{error.code ? `${error.code}: ` : ""}</span>
                <span>{error.message}</span>
                {error.location ? (
                  <span className="text-muted-foreground">（{error.location}）</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {warningList.length > 0 ? (
          <div className="space-y-1 rounded-md border border-amber-300/70 bg-amber-50/80 p-2">
            <div className="text-xs font-medium text-amber-700">风险提示</div>
            {warningList.map((warning, index) => (
              <div key={`${warning.code ?? "warning"}-${index}`} className="text-xs text-amber-800">
                <span className="font-medium">{warning.code ? `${warning.code}: ` : ""}</span>
                <span>{warning.message}</span>
                {warning.location ? (
                  <span className="text-amber-700/80">（{warning.location}）</span>
                ) : null}
                {warning.hint ? (
                  <div className="text-amber-700/80">建议：{warning.hint}</div>
                ) : null}
              </div>
            ))}
            {compact && warningItems.length > warningList.length ? (
              <div className="text-xs text-amber-700/80">
                另有 {warningItems.length - warningList.length} 项风险未展开
              </div>
            ) : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
