"use client";

import {
  Plus,
  Trash2,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Upload,
  Download,
  AlertTriangle,
  Bot,
  Key,
  Globe,
  Cpu,
} from "lucide-react";
import React, { useEffect, useState, useCallback } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  useAiProviderStore,
  type AiProviderConfig,
  type AiProviderType,
} from "@/core/ai/ai-provider-store";
import { globalAiService } from "@/core/ai/global-ai-service";

import { SettingsSection } from "./settings-section";

export function AiProviderSettingsPage() {
  const {
    hydrated,
    hydrating,
    hydrationError,
    draft,
    isDirty,
    ensureHydrated,
    refreshFromServer,
    resetDraftToEffective,
    saveDraftToServer,
    addProvider,
    updateProvider,
    deleteProvider,
    setActiveProvider,
    updateGlobalSettings,
    exportConfig,
    importConfig,
    resetToDefaults,
  } = useAiProviderStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<AiProviderConfig>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    ensureHydrated().catch(() => undefined);
  }, [ensureHydrated]);

  const handleSave = useCallback(async () => {
    if (editingId) {
      updateProvider(editingId, formData);
      setSaving(true);
      setSaveError(null);
      try {
        await saveDraftToServer();
        setEditingId(null);
        setFormData({});
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "保存失败，请检查后端服务";
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    }
  }, [editingId, formData, saveDraftToServer, updateProvider]);

  const handleAdd = useCallback(() => {
    const id = crypto.randomUUID();
    const newProvider: AiProviderConfig = {
      id,
      name: "新供应商",
      provider: "openai",
      apiKey: "",
      baseUrl: "",
      models: [],
      isActive: false,
      hasApiKey: false,
      clearApiKey: false,
    };
    addProvider(newProvider);
    setEditingId(id);
    setFormData(newProvider);
  }, [addProvider]);

  const handleDelete = useCallback(
    async (id: string) => {
      deleteProvider(id);
      if (editingId === id) {
        setEditingId(null);
        setFormData({});
      }
      setSaving(true);
      setSaveError(null);
      try {
        await saveDraftToServer();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "删除后保存失败，请检查后端服务";
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    },
    [deleteProvider, editingId, saveDraftToServer]
  );

  const handleSetActive = useCallback(
    async (id: string) => {
      setActiveProvider(id);
      setSaving(true);
      setSaveError(null);
      try {
        await saveDraftToServer();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "切换供应商后保存失败，请检查后端服务";
        setSaveError(message);
      } finally {
        setSaving(false);
      }
    },
    [saveDraftToServer, setActiveProvider]
  );

  const handleTestConnection = useCallback(async (id: string) => {
    setTestingId(id);
    setTestResult(null);

    // Ensure we test the saved server config (single source of truth).
    setSaving(true);
    setSaveError(null);
    try {
      if (isDirty) {
        await saveDraftToServer();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "保存失败，无法测试连接";
      setSaving(false);
      setTestingId(null);
      setTestResult({ success: false, message });
      return;
    } finally {
      setSaving(false);
    }

    const result = await globalAiService.testConnection(id);

    setTestingId(null);
    setTestResult({
      success: result.success,
      message: result.message,
    });
  }, [isDirty, saveDraftToServer]);

  const handleExport = useCallback(() => {
    try {
      const config = exportConfig();
      const blob = new Blob([config], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-provider-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("导出配置失败:", error);
    }
  }, [exportConfig]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const success = importConfig(text);
        if (success) {
          alert("配置导入成功！");
        } else {
          alert("配置文件格式错误，导入失败！");
        }
      } catch (error) {
        console.error("导入配置失败:", error);
        alert("读取文件失败！");
      }
    };

    input.click();
  }, [importConfig]);

  return (
    <div className="space-y-8">
      {hydrationError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>AI 设置加载失败</AlertTitle>
          <AlertDescription>
            {hydrationError}（严格以后端为准，已禁用本地回退编辑）
          </AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>保存失败</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <SettingsSection
        title="AI 供应商管理"
        description="配置和管理 AI 模型供应商，支持 OpenAI、Anthropic、Google 等多种服务"
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">供应商列表</CardTitle>
                <CardDescription>
                  添加并配置您的 AI 服务提供商，可同时配置多个供应商
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSaveError(null);
                    refreshFromServer().catch((err) => {
                      const message =
                        err instanceof Error ? err.message : "刷新失败";
                      setSaveError(message);
                    });
                  }}
                  disabled={hydrating || saving}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${hydrating ? "animate-spin" : ""}`} />
                  刷新
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetDraftToEffective}
                  disabled={saving || !hydrated}
                >
                  撤销未保存
                </Button>
                <Button variant="outline" size="sm" onClick={handleExport}>
                  <Download className="h-4 w-4 mr-1" />
                  导出
                </Button>
                <Button variant="outline" size="sm" onClick={handleImport}>
                  <Upload className="h-4 w-4 mr-1" />
                  导入
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft.providers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Bot className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-sm">暂未配置任何 AI 供应商</p>
                <p className="text-xs mt-1">点击下方按钮添加您的第一个 AI 供应商</p>
              </div>
            ) : (
              <div className="space-y-3">
                {draft.providers.map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    isEditing={editingId === provider.id}
                    isTesting={testingId === provider.id}
                    testResult={testResult}
                    formData={formData}
                    onEdit={() => {
                      setEditingId(provider.id);
                      setFormData({
                        ...provider,
                        apiKey: "",
                        clearApiKey: false,
                      });
                    }}
                    onSave={handleSave}
                    onDelete={() => void handleDelete(provider.id)}
                    onSetActive={() => void handleSetActive(provider.id)}
                    onTestConnection={() => handleTestConnection(provider.id)}
                    onFormChange={(data) => {
                      setFormData(data);
                    }}
                  />
                ))}
              </div>
            )}

            <Button
              variant="outline"
              onClick={handleAdd}
              className="w-full"
              disabled={Boolean(hydrationError) || saving}
            >
              <Plus className="h-4 w-4 mr-2" />
              添加供应商
            </Button>
          </CardContent>
        </Card>
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="全局 AI 设置"
        description="配置 AI 服务的默认行为参数"
      >
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>系统提示词</Label>
                <Input
                  value={draft.globalSystemPrompt}
                  onChange={(e) =>
                    updateGlobalSettings({ globalSystemPrompt: e.target.value })
                  }
                  placeholder="可选的全局系统提示词"
                  disabled={Boolean(hydrationError) || saving}
                />
              </div>

              <div className="space-y-2">
                <Label>请求超时时间（毫秒）</Label>
                <Input
                  type="number"
                  value={draft.requestTimeout}
                  onChange={(e) =>
                    updateGlobalSettings({
                      requestTimeout: Number.isFinite(Number.parseInt(e.target.value))
                        ? Number.parseInt(e.target.value)
                        : 120000,
                    })
                  }
                  disabled={Boolean(hydrationError) || saving}
                />
              </div>

              <div className="space-y-2">
                <Label>最大重试次数</Label>
                <Input
                  type="number"
                  value={draft.maxRetries}
                  onChange={(e) =>
                    updateGlobalSettings({
                      maxRetries: Number.isFinite(Number.parseInt(e.target.value))
                        ? Number.parseInt(e.target.value)
                        : 2,
                    })
                  }
                  min={0}
                  max={5}
                  disabled={Boolean(hydrationError) || saving}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>启用流式模式</Label>
                  <p className="text-xs text-muted-foreground">
                    启用后 AI 响应将以流式方式返回，提升用户体验
                  </p>
                </div>
                <Switch
                  checked={draft.enableStreamMode}
                  onCheckedChange={(checked) =>
                    updateGlobalSettings({ enableStreamMode: checked })
                  }
                  disabled={Boolean(hydrationError) || saving}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                className="mr-2"
                onClick={async () => {
                  setSaving(true);
                  setSaveError(null);
                  try {
                    await saveDraftToServer();
                  } catch (err) {
                    const message =
                      err instanceof Error ? err.message : "保存失败";
                    setSaveError(message);
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={Boolean(hydrationError) || saving || !isDirty}
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    保存更改
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    confirm("确定要重置所有 AI 设置为默认值吗？")
                  ) {
                    resetToDefaults();
                  }
                }}
                disabled={Boolean(hydrationError) || saving}
              >
                重置为默认值
              </Button>
            </div>
          </CardContent>
        </Card>
      </SettingsSection>
    </div>
  );
}

function ProviderCard({
  provider,
  isEditing,
  isTesting,
  testResult,
  formData,
  onEdit,
  onSave,
  onDelete,
  onSetActive,
  onTestConnection,
  onFormChange,
}: {
  provider: AiProviderConfig;
  isEditing: boolean;
  isTesting: boolean;
  testResult: { success: boolean; message: string } | null;
  formData: Partial<AiProviderConfig>;
  onEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSetActive: () => void;
  onTestConnection: () => void;
  onFormChange: (data: Partial<AiProviderConfig>) => void;
}) {
  const providerIcons: Record<AiProviderType, typeof Bot> = {
    openai: Bot,
    anthropic: Cpu,
    google: Globe,
    custom: Key,
  };

  const Icon = providerIcons[provider.provider] ?? Bot;

  return (
    <div
      className={`rounded-lg border p-4 transition-all ${
        provider.isActive
          ? "border-primary bg-primary/5 shadow-sm"
          : "hover:border-border/80"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`rounded-md p-2 ${
              provider.isActive ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="font-medium text-sm flex items-center gap-2">
              {provider.name}
              {provider.isActive && (
                <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded">
                  当前使用
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {provider.provider}
              {provider.models.length > 0 &&
                ` · ${provider.models[0]}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!provider.isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onSetActive}
              title="设为当前使用"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEdit}
            title="编辑"
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onDelete}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="space-y-3 mt-3 pl-11 border-l-2 border-border/50">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">名称</Label>
              <Input
                value={formData.name ?? ""}
                onChange={(e) =>
                  onFormChange({ ...formData, name: e.target.value })
                }
                placeholder="供应商名称"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">提供商类型</Label>
              <Select
                value={formData.provider ?? "openai"}
                onValueChange={(v) =>
                  onFormChange({
                    ...formData,
                    provider: v as AiProviderType,
                  })
                }
              >
                <SelectTrigger className="h-8">
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

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">API Key</Label>
              {provider.hasApiKey ? (
                <p className="text-xs text-muted-foreground">
                  已保存 API Key（留空将保留；如需清空请点击“清空已保存”）
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  未检测到已保存 API Key（可留空以使用后端环境变量/默认配置）
                </p>
              )}
              <Input
                type="password"
                value={formData.apiKey ?? ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    apiKey: e.target.value,
                    clearApiKey: false,
                  })
                }
                placeholder="sk-..."
              />
              {provider.hasApiKey && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onFormChange({ ...formData, apiKey: "", clearApiKey: true })
                  }
                >
                  清空已保存
                </Button>
              )}
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Base URL</Label>
              <Input
                value={formData.baseUrl ?? ""}
                onChange={(e) =>
                  onFormChange({ ...formData, baseUrl: e.target.value })
                }
                placeholder={
                  formData.provider === "openai"
                    ? "https://api.openai.com/v1"
                    : formData.provider === "anthropic"
                    ? "https://api.anthropic.com"
                    : "https://..."
                }
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">模型列表（逗号分隔）</Label>
              <Input
                value={formData.models?.join(", ") ?? ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    models: e.target.value
                      .split(",")
                      .map((m) => m.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="gpt-4o, gpt-4o-mini, gpt-3.5-turbo"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">温度参数</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formData.temperature ?? 0.7}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    temperature: parseFloat(e.target.value),
                  })
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">最大 Token 数</Label>
              <Input
                type="number"
                value={formData.maxTokens ?? 2000}
                onChange={(e) =>
                    onFormChange({
                      ...formData,
                      maxTokens: Number.isFinite(Number.parseInt(e.target.value))
                        ? Number.parseInt(e.target.value)
                        : 2000,
                    })
                  }
                />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" onClick={onSave}>
              保存配置
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onTestConnection}
              disabled={isTesting}
            >
              {isTesting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                  测试中...
                </>
              ) : (
                "测试连接"
              )}
            </Button>

            {testResult && (
              <div
                className={`flex items-center gap-1 text-xs ${
                  testResult.success ? "text-green-600" : "text-red-600"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                {testResult.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
