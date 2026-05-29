"use client";

import { Globe } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AiProviderConfig } from "@/core/ai/ai-provider-store";
import type { AiModelTarget } from "@/core/ai/feature-routing";

import { HelpTip } from "./help-tip";
import { SearchableModelSelector } from "./searchable-model-selector";

export interface GlobalRoutingPanelProps {
  providers: AiProviderConfig[];
  defaultTarget: AiModelTarget | null;
  globalBackup: AiModelTarget | null;
  globalAutoFailover: boolean;
  globalParallelEnabled: boolean;
  globalPending: boolean;
  onDefaultTargetChange: (target: AiModelTarget | null) => void;
  onGlobalBackupChange: (target: AiModelTarget | null) => void;
  onGlobalAutoFailoverChange: (value: boolean) => void;
  onGlobalParallelEnabledChange: (value: boolean) => void;
  onApplyGlobal: () => void;
}

export function GlobalRoutingPanel({
  providers,
  defaultTarget,
  globalBackup,
  globalAutoFailover,
  globalParallelEnabled,
  globalPending,
  onDefaultTargetChange,
  onGlobalBackupChange,
  onGlobalAutoFailoverChange,
  onGlobalParallelEnabledChange,
  onApplyGlobal,
}: GlobalRoutingPanelProps) {
  return (
    <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Globe className="h-5 w-5 text-primary" />
        <span className="text-base font-semibold">全局设置</span>
        <HelpTip text="配置主用和备用模型后，点击「应用到所有功能」即可一键配置所有功能模块" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SearchableModelSelector
          label="主用模型"
          help="所有功能默认使用的 AI 模型"
          target={defaultTarget}
          providers={providers}
          allowEmpty
          onChange={onDefaultTargetChange}
        />
        <SearchableModelSelector
          label="备用模型（可选）"
          help="主用模型不可用时自动切换至此模型"
          target={globalBackup}
          providers={providers}
          allowEmpty
          onChange={onGlobalBackupChange}
        />
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center justify-between rounded-md border p-3 flex-1">
          <div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium">自动切换</span>
              <HelpTip text="主用模型不可用时，自动切换到备用模型" />
            </div>
            <p className="text-xs text-muted-foreground">需要设置备用模型</p>
          </div>
          <Switch
            checked={globalAutoFailover}
            onCheckedChange={onGlobalAutoFailoverChange}
            disabled={!globalBackup}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3 flex-1">
          <div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-medium">多模型并行</span>
              <HelpTip text="同时向多个模型发送请求" />
            </div>
            <p className="text-xs text-muted-foreground">同时调用多个模型</p>
          </div>
          <Switch
            checked={globalParallelEnabled}
            onCheckedChange={onGlobalParallelEnabledChange}
          />
        </div>
      </div>

      <Button
        className="w-full"
        size="sm"
        onClick={onApplyGlobal}
        disabled={!defaultTarget}
      >
        <Globe className="h-4 w-4 mr-2" />
        应用到所有功能
      </Button>
      {globalPending && (
        <p className="text-xs text-emerald-700 text-center">
          设置已修改但尚未应用，请点击上方按钮将配置推送到各功能模块
        </p>
      )}
    </div>
  );
}
