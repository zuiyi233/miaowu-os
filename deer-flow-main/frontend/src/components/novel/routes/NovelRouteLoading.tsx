import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

type NovelRouteLoadingVariant = "home" | "workspace" | "chapters";

interface NovelRouteLoadingProps {
  variant?: NovelRouteLoadingVariant;
}

function SidebarSkeleton() {
  return (
    <aside className="hidden border-r bg-muted/10 md:block md:w-72">
      <div className="space-y-5 p-4">
        <div className="rounded-lg border bg-background px-3 py-2">
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="h-4 w-36" />
        </div>
        {Array.from({ length: 3 }).map((_, groupIndex) => (
          <div key={groupIndex} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 4 }).map((__, itemIndex) => (
              <Skeleton key={itemIndex} className="h-8 w-full" />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function HomeSkeleton() {
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-lg border p-4">
            <Skeleton className="mb-3 h-5 w-3/4" />
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="mb-6 h-4 w-2/3" />
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 w-8" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChaptersSkeleton() {
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="rounded-lg border p-6">
        <div className="mb-5 space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-36" />
              </div>
              <div className="ml-3 flex gap-2">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-9" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <SidebarSkeleton />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        <div className="border-b bg-muted/20 px-3 py-2 md:px-4">
          <Skeleton className="h-8 w-full max-w-xl" />
        </div>
        {children}
      </main>
    </div>
  );
}

export function NovelRouteLoading({ variant = "workspace" }: NovelRouteLoadingProps) {
  if (variant === "home") {
    return <HomeSkeleton />;
  }

  const content = variant === "chapters" ? <ChaptersSkeleton /> : <HomeSkeleton />;
  return <WorkspaceSkeleton>{content}</WorkspaceSkeleton>;
}
