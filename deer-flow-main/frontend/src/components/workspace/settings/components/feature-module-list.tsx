"use client";

import { AlertTriangle, ChevronDown, Shield, Trash2 } from "lucide-react";
import React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AiProviderConfig } from "@/core/ai/ai-provider-store";
import {
  type AiFeatureModuleRoute,
  type AiFeatureRoutingState,
  type AiModelTarget,
  type AiParallelStrategy,
} from "@/core/ai/feature-routing";
import { cn } from "@/lib/utils";

import { HelpTip } from "./help-tip";
import { SearchableModelSelector, formatModelDisplay } from "./searchable-model-selector";
import { CATEGORY_LABELS } from "../utils/model-capabilities";

export interface FeatureModuleListProps {
  routingDraft: AiFeatureRoutingState | null;
  expandedModules: Set<string>;
  providers: AiProviderConfig[];
  isModuleUsingGlobal: (moduleId: AiFeatureModuleRoute) => boolean;
  onToggleExpand: (moduleId: string) => void;
  createPrimaryChangeHandler: (moduleId: string, parallelTargets: AiFeatureModuleRoute["parallelTargets"]) => (target: AiModelTarget | null) => void;
  createBackupChangeHandler: (moduleId: string, currentMode: AiFeatureModuleRoute["currentMode"]) => (target: AiModelTarget | null) => void;
  patchModule: (moduleId: string, patch: Partial<AiFeatureModuleRoute>) => void;
  onRemoveModule: (moduleId: string) => void;
  deleteModuleConfirmId: string | null;
  onDeleteModuleConfirm: (id: string | null) => void;
}

export function FeatureModuleList({
  routingDraft,
  expandedModules,
  providers,
  isModuleUsingGlobal,
  onToggleExpand,
  createPrimaryChangeHandler,
  createBackupChangeHandler,
  patchModule,
  onRemoveModule,
  deleteModuleConfirmId,
  onDeleteModuleConfirm,
}: FeatureModuleListProps) {
  const modules = routingDraft?.modules ?? [];

  return (
    <div className="space-y-3 mt-6">
      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
        <span>各功能模块</span>
        <span className="text-xs">（点击展开可单独调整）</span>
      </h3>

      {modules.map((moduleRoute) => {
        const isExpanded = expandedModules.has(moduleRoute.moduleId);
        const isCustom = moduleRoute.category === "custom";
        const usingGlobal = isModuleUsingGlobal(moduleRoute);
        const activeTarget =
          moduleRoute.currentMode === "backup" && moduleRoute.backupTarget
            ? moduleRoute.backupTarget
            : moduleRoute.primaryTarget;

        return (
          <div key={moduleRoute.moduleId} className={cn("rounded-lg border transition-colors", usingGlobal ? "bg-muted/10" : "bg-muted/20")}>
            <button
              type="button"
              className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/10 transition-colors"
              onClick={() => onToggleExpand(moduleRoute.moduleId)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                <span className="text-sm font-medium truncate">{moduleRoute.moduleLabel}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {CATEGORY_LABELS[moduleRoute.category]}
                </Badge>
                {usingGlobal ? (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    使用全局设置
                  </Badge>
                ) : (
                  <Badge variant="default" className="text-[10px] shrink-0 bg-emerald-700">
                    已自定义
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {activeTarget && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px] hidden sm:inline">
                    {formatModelDisplay(activeTarget, providers)}
                  </span>
                )}
                {isCustom && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteModuleConfirm(moduleRoute.moduleId);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">{moduleRoute.moduleLabel}</span>
                  <span className="text-xs text-muted-foreground">自定义配置</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <SearchableModelSelector
                    label="主用模型"
                    help="优先使用的 AI 模型"
                    target={moduleRoute.primaryTarget}
                    providers={providers}
                    allowEmpty
                    onChange={createPrimaryChangeHandler(moduleRoute.moduleId, moduleRoute.parallelTargets)}
                  />
                  <SearchableModelSelector
                    label="备用模型"
                    help="主用模型不可用时自动切换至此模型"
                    target={moduleRoute.backupTarget}
                    providers={providers}
                    allowEmpty
                    onChange={createBackupChangeHandler(moduleRoute.moduleId, moduleRoute.currentMode)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">自动切换</span>
                        <HelpTip text="当主用模型不可用时，自动切换到备用模型" />
                      </div>
                      <p className="text-xs text-muted-foreground">需要设置备用模型</p>
                    </div>
                    <Switch
                      checked={moduleRoute.autoFailover}
                      onCheckedChange={(checked) =>
                        patchModule(moduleRoute.moduleId, { autoFailover: checked })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium">多模型并行</span>
                        <HelpTip text="同时向多个模型发送请求" />
                      </div>
                      <p className="text-xs text-muted-foreground">同时调用多个模型</p>
                    </div>
                    <Switch
                      checked={moduleRoute.parallelEnabled}
                      onCheckedChange={(checked) =>
                        patchModule(moduleRoute.moduleId, { parallelEnabled: checked })
                      }
                    />
                  </div>
                </div>

                {moduleRoute.parallelEnabled && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-medium">并行策略</span>
                      <HelpTip text="对比：展示所有结果；择优：自动选择最佳结果；融合：合并多个结果" />
                    </div>
                    <Select
                      value={moduleRoute.parallelStrategy}
                      onValueChange={(value) =>
                        patchModule(moduleRoute.moduleId, {
                          parallelStrategy: value as AiParallelStrategy,
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="compare">对比展示</SelectItem>
                        <SelectItem value="auto">自动择优</SelectItem>
                        <SelectItem value="fusion">结果融合</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={deleteModuleConfirmId !== null} onOpenChange={(open) => { if (!open) onDeleteModuleConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除这个自定义模块吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onDeleteModuleConfirm(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteModuleConfirmId) onRemoveModule(deleteModuleConfirmId);
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
