"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";

interface NovelRouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function NovelRouteError({ error, reset }: NovelRouteErrorProps) {
  const { t } = useI18n();
  const message = error.message || t.novel.routeLoadFailedDescription;

  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded-md bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t.novel.routeLoadFailed}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.novel.routeLoadFailedDescription}</p>
          </div>
        </div>
        <p className="mb-5 break-words rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </p>
        <Button type="button" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
          {t.novel.retry}
        </Button>
      </div>
    </div>
  );
}
