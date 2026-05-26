"use client";

import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NewApiSyncGroupItem, NewApiSyncGroupResult } from "@/core/ai/useAiSettingsApi";
import { cn } from "@/lib/utils";

import { newApiSyncStatusLabel } from "../utils/newapi-helpers";

export interface NewApiSyncDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
  groups: NewApiSyncGroupItem[];
  selectedGroups: Set<string>;
  manualGroups: string;
  warnings: string[];
  results: NewApiSyncGroupResult[];
  loading: boolean;
  applying: boolean;
  error: string | null;
  onSelectedGroupsChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  onManualGroupsChange: (value: string) => void;
  onApply: () => Promise<void>;
  onReloadGroups: () => Promise<void>;
  onOpenLoginTab: () => void;
}

export function NewApiSyncDialog({
  open,
  onClose,
  onOpenChange,
  groups,
  selectedGroups,
  manualGroups,
  warnings,
  results,
  loading,
  applying,
  error,
  onSelectedGroupsChange,
  onManualGroupsChange,
  onApply,
  onReloadGroups,
  onOpenLoginTab,
}: NewApiSyncDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>同步 NewAPI 分组</DialogTitle>
          <DialogDescription>
            选择要同步的 NewAPI 分组，后端会为每个分组创建或复用密钥并拉取模型；密钥不会返回到浏览器。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onReloadGroups()}
              disabled={loading || applying}
            >
              <RefreshCw className={cn("mr-1 h-4 w-4", loading && "animate-spin")} />
              重新发现分组
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenLoginTab}
              disabled={applying}
            >
              <ExternalLink className="mr-1 h-4 w-4" />
              重新登录 NewAPI
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>NewAPI 同步失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>需要注意</AlertTitle>
              <AlertDescription className="space-y-1">
                {warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>发现到的分组</Label>
              <div className="flex items-center gap-2">
                {groups.length > 0 && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelectedGroupsChange(new Set(groups.map((group) => group.group_id)))}
                      disabled={loading || applying}
                    >
                      全选
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelectedGroupsChange(new Set())}
                      disabled={loading || applying}
                    >
                      清空
                    </Button>
                  </>
                )}
                <span className="text-xs text-muted-foreground">
                  {loading ? "读取中" : `${selectedGroups.size}/${groups.length} 个分组`}
                </span>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {groups.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {loading ? "正在读取 NewAPI 分组..." : "未发现分组，可在下方手动输入。"}
                </div>
              ) : (
                <div className="divide-y">
                  {groups.map((group) => {
                    const checked = selectedGroups.has(group.group_id);
                    const status = group.model_sync_status ?? (group.already_synced ? "synced" : null);
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        key={group.group_id}
                        className="flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left hover:bg-muted/50"
                        onClick={() => {
                          if (applying) return;
                          onSelectedGroupsChange((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.group_id)) next.delete(group.group_id);
                            else next.add(group.group_id);
                            return next;
                          });
                        }}
                        onKeyDown={(event) => {
                          if (applying || (event.key !== "Enter" && event.key !== " ")) return;
                          event.preventDefault();
                          onSelectedGroupsChange((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.group_id)) next.delete(group.group_id);
                            else next.add(group.group_id);
                            return next;
                          });
                        }}
                      >
                        <Checkbox
                          checked={checked}
                          aria-label={`选择 ${group.name || group.group_id}`}
                          onCheckedChange={(value) => {
                            onSelectedGroupsChange((prev) => {
                              const next = new Set(prev);
                              if (value) next.add(group.group_id);
                              else next.delete(group.group_id);
                              return next;
                            });
                          }}
                          onClick={(event) => event.stopPropagation()}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{group.name || group.group_id}</span>
                            <Badge variant="outline">{group.group_id}</Badge>
                            <Badge variant={status === "error" ? "destructive" : "secondary"}>
                              {newApiSyncStatusLabel(status)}
                            </Badge>
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {group.model_count} 个模型
                            {group.already_synced ? " · 已有本地 provider" : ""}
                            {group.has_api_key ? " · 已有服务端密钥" : ""}
                          </span>
                          {group.model_sync_error && (
                            <span className="mt-1 block text-xs text-destructive">{group.model_sync_error}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newapi-manual-groups">手动输入分组名</Label>
            <Input
              id="newapi-manual-groups"
              value={manualGroups}
              onChange={(event) => onManualGroupsChange(event.target.value)}
              placeholder="例如：default, vip, svip"
              disabled={applying}
            />
            <p className="text-xs text-muted-foreground">
              当 NewAPI 分组目录不完整时，可手动输入分组名；多个分组用逗号、空格或换行分隔。
            </p>
          </div>

          {results.length > 0 && (
            <div className="space-y-2">
              <Label>同步结果</Label>
              <div className="rounded-md border">
                {results.map((result) => (
                  <div key={`${result.group_id}-${result.provider_id}`} className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-b-0">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{result.group_id}</span>
                        <Badge variant={result.status === "error" ? "destructive" : "secondary"}>
                          {newApiSyncStatusLabel(result.status)}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {result.provider_id} · {result.model_count} 个模型 · {result.has_api_key ? "已有密钥" : "无密钥"}
                      </div>
                      {result.error && <div className="mt-1 text-xs text-destructive">{result.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button type="button" onClick={() => void onApply()} disabled={applying || loading}>
            <RefreshCw className={cn("mr-1 h-4 w-4", applying && "animate-spin")} />
            同步选中分组
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
