"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyOptimisticDraftHide,
  attachDraftMedia,
  deleteDraftMedia,
  rollbackOptimisticDraftHide,
  resolveDraftContentUrl,
  type DraftAttachTargetType,
  type DraftMediaItem,
  type DraftMediaMap,
} from "@/core/media/drafts";
import { cn } from "@/lib/utils";

const DRAFT_MEDIA_VIRTUAL_ROW_ESTIMATE = 420;
const DRAFT_MEDIA_VIRTUAL_OVERSCAN = 2;
const DRAFT_MEDIA_VIRTUAL_THRESHOLD = 12;
const DRAFT_MEDIA_VIRTUAL_MAX_HEIGHT = 720;

export interface DraftMediaVirtualSlice {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

export function computeDraftMediaVirtualSlice({
  total,
  scrollTop,
  viewportHeight,
  rowEstimate = DRAFT_MEDIA_VIRTUAL_ROW_ESTIMATE,
  overscan = DRAFT_MEDIA_VIRTUAL_OVERSCAN,
}: {
  total: number;
  scrollTop: number;
  viewportHeight: number;
  rowEstimate?: number;
  overscan?: number;
}): DraftMediaVirtualSlice {
  if (total <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }

  const safeRowEstimate = rowEstimate > 0 ? rowEstimate : DRAFT_MEDIA_VIRTUAL_ROW_ESTIMATE;
  const safeViewportHeight = viewportHeight > 0 ? viewportHeight : DRAFT_MEDIA_VIRTUAL_MAX_HEIGHT;
  const safeOverscan = Math.max(0, overscan);
  const rawStart = Math.floor(Math.max(0, scrollTop) / safeRowEstimate) - safeOverscan;
  const startIndex = Math.max(0, rawStart);
  const visibleCount = Math.ceil(safeViewportHeight / safeRowEstimate) + safeOverscan * 2;
  const endIndex = Math.min(total, startIndex + visibleCount);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * safeRowEstimate,
    paddingBottom: Math.max(0, (total - endIndex) * safeRowEstimate),
  };
}

function isExpired(item: DraftMediaItem): boolean {
  if (!item.expires_at) {
    return false;
  }
  const ts = Date.parse(item.expires_at);
  return Number.isFinite(ts) ? ts <= Date.now() : false;
}

function formatExpiryHint(item: DraftMediaItem): string {
  if (!item.expires_at) {
    return "永不过期";
  }
  const ts = Date.parse(item.expires_at);
  if (!Number.isFinite(ts)) {
    return `过期时间：${item.expires_at}`;
  }
  const seconds = Math.floor((ts - Date.now()) / 1000);
  if (seconds <= 0) {
    return "已过期";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `约 ${minutes} 分钟后过期`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `约 ${hours} 小时后过期`;
  }
  const days = Math.floor(hours / 24);
  return `约 ${days} 天后过期`;
}

export function DraftMediaList({
  threadId,
  draftMedia,
  defaultProjectId,
  className,
}: {
  threadId: string;
  draftMedia: DraftMediaMap;
  defaultProjectId?: string;
  className?: string;
}) {
  const [hiddenIds, setHiddenIds] = useState<Record<string, true>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingItem, setPendingItem] = useState<DraftMediaItem | null>(null);
  const [attachTargetType, setAttachTargetType] =
    useState<DraftAttachTargetType>("project");
  const [attachTargetId, setAttachTargetId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DRAFT_MEDIA_VIRTUAL_MAX_HEIGHT);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const attachTargetOptions = [
    { value: "project", label: "项目" },
    { value: "character", label: "角色" },
    { value: "scene", label: "场景" },
  ] as const;

  const items = useMemo(() => {
    const values = Object.values(draftMedia ?? {});
    values.sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return values.filter((item) => !hiddenIds[item.id] && !isExpired(item));
  }, [draftMedia, hiddenIds]);
  const enableVirtualization = items.length > DRAFT_MEDIA_VIRTUAL_THRESHOLD;

  useEffect(() => {
    if (!enableVirtualization) {
      if (scrollTop !== 0) {
        setScrollTop(0);
      }
      return;
    }
    const container = listContainerRef.current;
    if (!container) {
      return;
    }
    const nextHeight = container.clientHeight || DRAFT_MEDIA_VIRTUAL_MAX_HEIGHT;
    if (nextHeight !== viewportHeight) {
      setViewportHeight(nextHeight);
    }
  }, [enableVirtualization, items.length, scrollTop, viewportHeight]);

  const virtualSlice = useMemo(
    () =>
      computeDraftMediaVirtualSlice({
        total: items.length,
        scrollTop,
        viewportHeight,
      }),
    [items.length, scrollTop, viewportHeight]
  );

  const visibleItems = enableVirtualization
    ? items.slice(virtualSlice.startIndex, virtualSlice.endIndex)
    : items;

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full space-y-4", className)}>
      <div className="text-muted-foreground text-sm">草稿产物（确认后才会挂载）</div>

      <div
        ref={listContainerRef}
        onScroll={
          enableVirtualization
            ? (event) => setScrollTop(event.currentTarget.scrollTop)
            : undefined
        }
        className={cn(
          enableVirtualization ? "max-h-[720px] overflow-y-auto pr-1" : "flex flex-col gap-4"
        )}
      >
        <div
          className="flex flex-col gap-4"
          style={
            enableVirtualization
              ? {
                  paddingTop: virtualSlice.paddingTop,
                  paddingBottom: virtualSlice.paddingBottom,
                }
              : undefined
          }
        >
          {visibleItems.map((item) => {
          const url = resolveDraftContentUrl(item);
          const busy = busyId === item.id;
          return (
            <Card key={item.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">
                    {item.kind === "image" ? "图片草稿" : "音频草稿"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatExpiryHint(item)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {item.kind === "image" ? (
                  <img
                    src={url}
                    alt="draft"
                    className="bg-muted aspect-square w-full rounded-md object-contain"
                    loading="lazy"
                  />
                ) : (
                  <audio className="w-full" controls src={url} preload="none" />
                )}

                {item.prompt ? (
                  <div className="text-muted-foreground text-xs">
                    Prompt: {item.prompt}
                  </div>
                ) : null}
                {item.text ? (
                  <div className="text-muted-foreground text-xs">
                    文本: {item.text}
                  </div>
                ) : null}
              </CardContent>
              <CardFooter className="flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    const wasHidden = Boolean(hiddenIds[item.id]);
                    setHiddenIds((prev) => applyOptimisticDraftHide(prev, item.id));
                    setBusyId(item.id);
                    try {
                      await deleteDraftMedia(threadId, item.id);
                      toast.success("已丢弃草稿");
                    } catch (error) {
                      if (!wasHidden) {
                        setHiddenIds((prev) =>
                          rollbackOptimisticDraftHide(prev, item.id)
                        );
                      }
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "丢弃失败",
                      );
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  丢弃
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setPendingItem(item);
                    setAttachTargetType("project");
                    setAttachTargetId(defaultProjectId ?? "");
                    setDialogOpen(true);
                  }}
                >
                  确认挂载
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setPendingItem(null);
            setAttachTargetId("");
            setAttachTargetType("project");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认挂载</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>目标类型</Label>
              <Select
                value={attachTargetType}
                onValueChange={(value) => setAttachTargetType(value as DraftAttachTargetType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择挂载目标" />
                </SelectTrigger>
                <SelectContent>
                  {attachTargetOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>目标 ID</Label>
              <Input
                value={attachTargetId}
                onChange={(e) => setAttachTargetId(e.target.value)}
                placeholder={
                  attachTargetType === "scene"
                    ? "例如 scene_entity_id"
                    : "例如 project_id / character_id"
                }
              />
              {attachTargetType === "scene" ? (
                <div className="text-muted-foreground text-xs">
                  scene 需要填写 scene entity id。
                </div>
              ) : attachTargetType === "project" && !defaultProjectId ? (
                <div className="text-muted-foreground text-xs">
                  当前线程未检测到 projectId，需手动填写。
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDialogOpen(false)}
              disabled={!pendingItem || busyId === pendingItem.id}
            >
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!pendingItem) {
                  return;
                }
                const targetId = attachTargetId.trim();
                if (!targetId) {
                  toast.error("目标 ID 不能为空");
                  return;
                }

                const optimisticItemId = pendingItem.id;
                const wasHidden = Boolean(hiddenIds[optimisticItemId]);
                setHiddenIds((prev) =>
                  applyOptimisticDraftHide(prev, optimisticItemId)
                );
                setBusyId(pendingItem.id);
                try {
                  const resp = await attachDraftMedia(
                    threadId,
                    pendingItem.id,
                    attachTargetType,
                    targetId,
                  );
                  if (resp.target_updated === false) {
                    const detail = resp.target_update_error?.trim();
                    if (!wasHidden) {
                      setHiddenIds((prev) =>
                        rollbackOptimisticDraftHide(prev, optimisticItemId)
                      );
                    }
                    toast.warning(
                      detail
                        ? `已生成挂载结果，但目标未更新：${detail}`
                        : "已生成挂载结果，但目标未更新，请检查目标 ID 后重试。",
                    );
                    return;
                  }

                  setDialogOpen(false);
                  toast.success("已挂载");
                } catch (error) {
                  if (!wasHidden) {
                    setHiddenIds((prev) =>
                      rollbackOptimisticDraftHide(prev, optimisticItemId)
                    );
                  }
                  toast.error(
                    error instanceof Error ? error.message : "挂载失败",
                  );
                } finally {
                  setBusyId(null);
                }
              }}
              disabled={!pendingItem || busyId === pendingItem.id}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
