import { Download, RefreshCw, Settings2, Shield, X } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  type AiProviderConfig,
  type AiProviderType,
} from "@/core/ai/ai-provider-store";
import { cn } from "@/lib/utils";

import { isNewApiManagedProvider } from "../utils/newapi-helpers";

export interface ProviderCardProps {
  provider: AiProviderConfig;
  isEditing: boolean;
  formData: Partial<AiProviderConfig>;
  fetchingModels: boolean;
  fetchModelsError: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSetActive: () => void;
  onFormChange: (data: Partial<AiProviderConfig>) => void;
  onFetchModels: () => void;
}

export function ProviderCard({
  provider,
  isEditing,
  formData,
  fetchingModels,
  fetchModelsError,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onSetActive,
  onFormChange,
  onFetchModels,
}: ProviderCardProps) {
  const providerTypeLabels: Record<AiProviderType, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    custom: "自定义",
  };

  const isManagedNewApi = isNewApiManagedProvider(provider);
  const modelGroupCount = Object.keys(provider.modelGroups ?? {}).length;
  const newApiGroupLabel = provider.managedGroup ? `分组：${provider.managedGroup}` : "默认分组";
  const syncError = provider.modelSyncError ?? (provider.models.length === 0 ? "未从 NewAPI 同步到可用模型" : "");
  const [modelInputMode, setModelInputMode] = useState<"tags" | "text">("tags");
  const [tagInput, setTagInput] = useState("");

  const models = useMemo(() => formData.models ?? [], [formData.models]);

  const addModelTag = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || models.includes(trimmed)) return;
      onFormChange({ ...formData, models: [...models, trimmed] });
    },
    [formData, models, onFormChange],
  );

  const removeModelTag = useCallback(
    (model: string) => {
      onFormChange({ ...formData, models: models.filter((m) => m !== model) });
    },
    [formData, models, onFormChange],
  );

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addModelTag(tagInput);
        setTagInput("");
      } else if (e.key === "Backspace" && !tagInput && models.length > 0) {
        removeModelTag(models[models.length - 1]!);
      }
    },
    [addModelTag, models, removeModelTag, tagInput],
  );

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all",
        provider.isActive ? "border-primary bg-primary/5" : "hover:border-border/80"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "rounded-md p-2 shrink-0",
              provider.isActive ? "bg-primary text-primary-foreground" : "bg-muted"
            )}
          >
            <Settings2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{provider.name}</span>
              {provider.isActive && (
                <Badge className="bg-primary text-primary-foreground text-[10px]">当前使用</Badge>
              )}
              {isManagedNewApi && (
                <Badge variant="secondary" className="text-[10px]">
                  NewAPI {newApiGroupLabel}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isManagedNewApi ? "后端托管" : providerTypeLabels[provider.provider]} · {provider.models.length} 个模型
              {modelGroupCount > 0 ? ` · ${modelGroupCount} 个分组` : ""}
              {isManagedNewApi && provider.modelSyncStatus ? ` · ${provider.modelSyncStatus}` : ""}
            </p>
            {isManagedNewApi && syncError && (
              <p className="mt-1 text-xs text-destructive line-clamp-2">{syncError}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!provider.isActive && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSetActive}>
              设为默认
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
            编辑
          </Button>
          {!isManagedNewApi && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={onDelete}>
              删除
            </Button>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="mt-4 pt-4 border-t space-y-3">
          {isManagedNewApi && (
            <Alert className="border-primary/30 bg-primary/5">
              <Shield className="h-4 w-4 text-primary" />
              <AlertTitle>NewAPI 由后端统一管理</AlertTitle>
              <AlertDescription>
                当前卡片对应 NewAPI {newApiGroupLabel}。该分组的 API Key 和接口地址来自服务端配置，不会暴露到浏览器。
                用户选择不同 NewAPI 分组时，后端会使用该分组绑定的密钥。
                {syncError ? ` 当前模型同步状态：${syncError}` : ""}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">显示名称</Label>
              <Input
                value={formData.name ?? ""}
                onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
                placeholder="例如：OpenAI 官方"
                disabled={isManagedNewApi}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">服务商类型</Label>
              <Select
                value={formData.provider ?? "openai"}
                onValueChange={(v) => onFormChange({ ...formData, provider: v as AiProviderType })}
                disabled={isManagedNewApi}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isManagedNewApi && (
              <>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    value={formData.apiKey ?? ""}
                    onChange={(e) => onFormChange({ ...formData, apiKey: e.target.value, clearApiKey: false })}
                    placeholder="sk-..."
                  />
                  {provider.hasApiKey && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => onFormChange({ ...formData, apiKey: "", clearApiKey: true })}
                    >
                      清空已保存的 Key
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs">接口地址（可选）</Label>
                  <Input
                    value={formData.baseUrl ?? ""}
                    onChange={(e) => onFormChange({ ...formData, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
              </>
            )}
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">模型列表</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={onFetchModels}
                    disabled={fetchingModels}
                  >
                    {fetchingModels ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {fetchingModels ? "获取中..." : "从供应商获取"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setModelInputMode(modelInputMode === "tags" ? "text" : "tags")}
                  >
                    {modelInputMode === "tags" ? "文本模式" : "标签模式"}
                  </Button>
                </div>
              </div>
              {fetchModelsError && (
                <p className="text-xs text-destructive">{fetchModelsError}</p>
              )}
              {modelInputMode === "tags" ? (
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-1 min-h-9 rounded-md border border-input bg-background px-3 py-2 text-sm",
                    "ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  )}
                >
                  {models.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-0.5 rounded bg-secondary text-secondary-foreground px-1.5 py-0.5 text-[11px]"
                    >
                      {m}
                      <button
                        type="button"
                        className="ml-0.5 hover:text-destructive"
                        onClick={() => removeModelTag(m)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    className="flex-1 min-w-[80px] bg-transparent outline-none placeholder:text-muted-foreground text-xs"
                    placeholder={models.length === 0 ? "输入模型名称，回车添加..." : "继续添加..."}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                  />
                </div>
              ) : (
                <Input
                  value={models.join(", ")}
                  onChange={(e) =>
                    onFormChange({
                      ...formData,
                      models: e.target.value.split(",").map((m) => m.trim()).filter(Boolean),
                    })
                  }
                  placeholder="gpt-4o, gpt-4o-mini, claude-3-opus"
                />
              )}
              {models.length > 0 && (
                <p className="text-[10px] text-muted-foreground">共 {models.length} 个模型</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" onClick={onSave}>
              保存
            </Button>
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
