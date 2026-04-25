"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Globe,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAiProviderStore,
  type AiProviderConfig,
  type AiProviderType,
} from "@/core/ai/ai-provider-store";
import {
  createCustomModuleRoute,
  getProviderDisplayName,
  isFeatureModuleConfigurableInSettings,
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
  saveFeatureRoutingState,
  type AiFeatureModuleRoute,
  type AiFeatureRoutingState,
  type AiModelTarget,
  type AiParallelStrategy,
} from "@/core/ai/feature-routing";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

const NONE_VALUE = "__none__";

const CATEGORY_LABELS: Record<AiFeatureModuleRoute["category"], string> = {
  workspace: "主项目",
  agent: "智能体",
  novel: "小说",
  custom: "自定义",
};

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="帮助"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  );
}

function ModelSelector({
  label,
  help,
  target,
  providers,
  allowEmpty,
  onChange,
}: {
  label: string;
  help: string;
  target: AiModelTarget | null;
  providers: AiProviderConfig[];
  allowEmpty?: boolean;
  onChange: (next: AiModelTarget | null) => void;
}) {
  const selectedProviderId = target?.providerId ?? NONE_VALUE;
  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const selectedModel =
    selectedProvider && target?.model && selectedProvider.models.includes(target.model)
      ? target.model
      : NONE_VALUE;

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium">{label}</span>
          {help && <HelpTip text={help} />}
        </div>
      )}
      <div className="flex gap-2">
        <Select
          value={selectedProviderId}
          onValueChange={(value) => {
            if (value === NONE_VALUE) {
              if (allowEmpty) onChange(null);
              return;
            }
            const provider = providers.find((p) => p.id === value);
            if (!provider || provider.models.length === 0) {
              onChange(null);
              return;
            }
            onChange({ providerId: provider.id, model: provider.models[0]! });
          }}
        >
          <SelectTrigger className="h-9 flex-1 min-w-0">
            <SelectValue placeholder="选择服务商" />
          </SelectTrigger>
          <SelectContent>
            {allowEmpty && <SelectItem value={NONE_VALUE}>未设置</SelectItem>}
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id} disabled={p.models.length === 0}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedModel}
          onValueChange={(value) => {
            if (value === NONE_VALUE || !selectedProvider) {
              onChange(null);
              return;
            }
            onChange({ providerId: selectedProvider.id, model: value });
          }}
          disabled={!selectedProvider || selectedProvider.models.length === 0}
        >
          <SelectTrigger className="h-9 flex-1 min-w-0">
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent>
            {allowEmpty && <SelectItem value={NONE_VALUE}>未设置</SelectItem>}
            {selectedProvider?.models.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function formatModelDisplay(target: AiModelTarget | null, providers: AiProviderConfig[]) {
  if (!target) return "未设置";
  return `${getProviderDisplayName(providers, target.providerId)} / ${target.model}`;
}

export function AiProviderSettingsPage() {
  const {
    hydrated,
    hydrating,
    hydrationError,
    draft,
    ensureHydrated,
    refreshFromServer,
    resetDraftToEffective,
    saveDraftToServer,
    saveFeatureRoutingToServer,
    addProvider,
    updateProvider,
    deleteProvider,
    setActiveProvider,
  } = useAiProviderStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<AiProviderConfig>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [routingDraft, setRoutingDraft] = useState<AiFeatureRoutingState | null>(null);
  const [routingDirty, setRoutingDirty] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingNotice, setRoutingNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [newModuleLabel, setNewModuleLabel] = useState("");
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteModuleConfirmId, setDeleteModuleConfirmId] = useState<string | null>(null);

  const [globalBackup, setGlobalBackup] = useState<AiModelTarget | null>(null);
  const [globalAutoFailover, setGlobalAutoFailover] = useState(true);
  const [globalParallelEnabled, setGlobalParallelEnabled] = useState(false);
  const [globalPending, setGlobalPending] = useState(false);

  useEffect(() => {
    if (routingNotice) {
      const timer = setTimeout(() => setRoutingNotice(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [routingNotice]);

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  useEffect(() => {
    ensureHydrated().catch(() => undefined);
  }, [ensureHydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const backendOrLocal = draft.featureRoutingSettings ?? loadFeatureRoutingState(draft.providers);
    const normalized = normalizeFeatureRoutingState(backendOrLocal, draft.providers);
    setRoutingDraft((prev) => {
      if (routingDirty && prev) return normalizeFeatureRoutingState(prev, draft.providers);
      return normalized;
    });
  }, [hydrated, draft.featureRoutingSettings, draft.providers, routingDirty]);

  const providers = draft.providers;
  const defaultTarget = routingDraft?.defaultTarget ?? null;

  const mutateRouting = useCallback(
    (updater: (state: AiFeatureRoutingState) => AiFeatureRoutingState) => {
      setRoutingDraft((prev) => {
        if (!prev) return prev;
        return normalizeFeatureRoutingState(updater(prev), providers);
      });
      setRoutingDirty(true);
      setRoutingNotice(null);
    },
    [providers]
  );

  const patchModule = useCallback(
    (moduleId: string, patch: Partial<AiFeatureModuleRoute>) => {
      mutateRouting((state) => ({
        ...state,
        modules: state.modules.map((m) => (m.moduleId === moduleId ? { ...m, ...patch } : m)),
      }));
    },
    [mutateRouting]
  );

  const isModuleUsingGlobal = useCallback(
    (module: AiFeatureModuleRoute) => {
      if (!defaultTarget) return module.primaryTarget === null;
      const samePrimary =
        module.primaryTarget !== null &&
        module.primaryTarget.providerId === defaultTarget.providerId &&
        module.primaryTarget.model === defaultTarget.model;
      const sameBackup =
        module.backupTarget === null
          ? globalBackup === null
          : globalBackup !== null &&
            module.backupTarget.providerId === globalBackup.providerId &&
            module.backupTarget.model === globalBackup.model;
      return samePrimary && sameBackup && module.parallelEnabled === globalParallelEnabled;
    },
    [defaultTarget, globalBackup, globalParallelEnabled]
  );

  const handleApplyGlobal = useCallback(() => {
    if (!routingDraft || !defaultTarget) {
      setRoutingNotice({ type: "error", message: "请先设置主用模型" });
      return;
    }
    const parallelTargets = globalParallelEnabled
      ? [defaultTarget, ...(globalBackup ? [globalBackup] : [])]
      : [];
    mutateRouting((state) => ({
      ...state,
      modules: state.modules.map((m) => ({
        ...(isFeatureModuleConfigurableInSettings(m.moduleId)
          ? {
              ...m,
              primaryTarget: defaultTarget,
              backupTarget: globalBackup,
              autoFailover: globalAutoFailover,
              parallelEnabled: globalParallelEnabled,
              parallelStrategy: "compare" as AiParallelStrategy,
              parallelTargets,
            }
          : m),
      })),
    }));
    setGlobalPending(false);
    setRoutingNotice({ type: "success", message: "已应用到可配置功能模块" });
  }, [defaultTarget, globalBackup, globalAutoFailover, globalParallelEnabled, mutateRouting, routingDraft]);

  const handleSaveProvider = useCallback(async () => {
    if (!editingId) return;
    updateProvider(editingId, formData);
    setSaving(true);
    setSaveError(null);
    try {
      await saveDraftToServer();
      setEditingId(null);
      setFormData({});
      setSaveSuccess("保存成功");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [editingId, formData, saveDraftToServer, updateProvider]);

  const handleAddProvider = useCallback(() => {
    const id = crypto.randomUUID();
    const newProvider: AiProviderConfig = {
      id,
      name: "新服务商",
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

  const handleDeleteProvider = useCallback(
    async (id: string) => {
      deleteProvider(id);
      if (editingId === id) {
        setEditingId(null);
        setFormData({});
      }
      setDeleteConfirmId(null);
      setSaving(true);
      try {
        await saveDraftToServer();
        setSaveSuccess("删除成功");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "删除失败");
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
      try {
        await saveDraftToServer();
        setSaveSuccess("已切换默认服务商");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "切换失败");
      } finally {
        setSaving(false);
      }
    },
    [saveDraftToServer, setActiveProvider]
  );

  const handleSaveRouting = useCallback(async () => {
    if (!routingDraft) return;
    setRoutingSaving(true);
    setRoutingNotice(null);
    try {
      const normalized = normalizeFeatureRoutingState(routingDraft, providers);
      saveFeatureRoutingState(normalized);
      await saveFeatureRoutingToServer(normalized);
      setRoutingDirty(false);
      setRoutingNotice({ type: "success", message: "模型配置已保存" });
    } catch (err) {
      setRoutingNotice({ type: "error", message: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setRoutingSaving(false);
    }
  }, [providers, routingDraft, saveFeatureRoutingToServer]);

  const handleAddCustomModule = useCallback(() => {
    const label = newModuleLabel.trim();
    if (!label) {
      setRoutingNotice({ type: "error", message: "请输入模块名称" });
      return;
    }
    mutateRouting((state) => ({
      ...state,
      modules: [...state.modules, createCustomModuleRoute(label, "", providers, state.defaultTarget)],
    }));
    setNewModuleLabel("");
  }, [mutateRouting, newModuleLabel, providers]);

  const handleRemoveCustomModule = useCallback(
    (moduleId: string) => {
      mutateRouting((state) => ({
        ...state,
        modules: state.modules.filter((m) => m.moduleId !== moduleId),
      }));
      setExpandedModules((prev) => {
        const next = new Set(prev);
        next.delete(moduleId);
        return next;
      });
      setDeleteModuleConfirmId(null);
    },
    [mutateRouting]
  );

  const toggleModuleExpand = useCallback((moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  const routingModules = routingDraft?.modules ?? [];
  const configurableRoutingModules = routingModules.filter((moduleRoute) =>
    isFeatureModuleConfigurableInSettings(moduleRoute.moduleId)
  );

  return (
    <div className="space-y-8">
      {hydrationError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{hydrationError}</AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {saveSuccess && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>操作成功</AlertTitle>
          <AlertDescription>{saveSuccess}</AlertDescription>
        </Alert>
      )}

      <SettingsSection title="AI 服务商" description="管理你的 AI 模型服务商，支持 OpenAI、Anthropic、Google 等">
        <div className="flex items-center gap-2 mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSaveError(null);
              setSaveSuccess(null);
              refreshFromServer().catch((err) => setSaveError(err instanceof Error ? err.message : "刷新失败"));
            }}
            disabled={hydrating || saving}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", hydrating && "animate-spin")} />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={resetDraftToEffective} disabled={saving || !hydrated}>
            撤销修改
          </Button>
          <Button variant="default" size="sm" onClick={handleAddProvider} disabled={Boolean(hydrationError) || saving}>
            <Plus className="h-4 w-4 mr-1" />
            添加服务商
          </Button>
        </div>

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground rounded-lg border border-dashed">
            <Bot className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">还没有添加任何 AI 服务商</p>
            <p className="text-xs mt-1">点击上方按钮添加你的第一个服务商</p>
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isEditing={editingId === provider.id}
                formData={formData}
                onEdit={() => {
                  setEditingId(provider.id);
                  setFormData({ ...provider, apiKey: "", clearApiKey: false });
                }}
                onCancel={() => {
                  setEditingId(null);
                  setFormData({});
                }}
                onSave={handleSaveProvider}
                onDelete={() => setDeleteConfirmId(provider.id)}
                onSetActive={() => void handleSetActive(provider.id)}
                onFormChange={(data) => setFormData(data)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="模型配置"
        description="只需配置一次，即可应用到所有功能。如需单独调整，可展开对应功能进行修改"
      >
        <Alert className="mb-4 border-primary/30 bg-primary/5">
          <Shield className="h-4 w-4 text-primary" />
          <AlertTitle>对话模型由对话框独立管理</AlertTitle>
          <AlertDescription>
            主项目对话（含智能体对话）请在聊天输入框顶部模型选择器中调整；本页仅配置记忆、灵感、小说工作流等系统能力模型。
          </AlertDescription>
        </Alert>

        {routingNotice && (
          <Alert variant={routingNotice.type === "error" ? "destructive" : "default"} className="mb-4">
            {routingNotice.type === "error" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            <AlertTitle>{routingNotice.type === "error" ? "操作失败" : "操作成功"}</AlertTitle>
            <AlertDescription>{routingNotice.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2 mb-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const backendOrLocal = draft.featureRoutingSettings ?? loadFeatureRoutingState(draft.providers);
              setRoutingDraft(normalizeFeatureRoutingState(backendOrLocal, draft.providers));
              setRoutingDirty(false);
              setRoutingNotice(null);
            }}
            disabled={!routingDirty || routingSaving}
          >
            撤销修改
          </Button>
          <Button size="sm" onClick={() => void handleSaveRouting()} disabled={!routingDirty || routingSaving}>
            {routingSaving ? (
              <>
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" />
                保存配置
              </>
            )}
          </Button>
        </div>

        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-5 w-5 text-primary" />
            <span className="text-base font-semibold">全局设置</span>
            <HelpTip text="配置主用和备用模型后，点击「应用到所有功能」即可一键配置所有功能模块" />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ModelSelector
              label="主用模型"
              help="所有功能默认使用的 AI 模型"
              target={defaultTarget}
              providers={providers}
              allowEmpty
              onChange={(target) => {
                mutateRouting((state) => ({
                  ...state,
                  defaultTarget: target,
                }));
              }}
            />
            <ModelSelector
              label="备用模型（可选）"
              help="主用模型不可用时自动切换至此模型"
              target={globalBackup}
              providers={providers}
              allowEmpty
              onChange={(target) => {
                setGlobalBackup(target);
                setGlobalPending(true);
                if (!target) setGlobalAutoFailover(false);
              }}
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
                onCheckedChange={(v) => { setGlobalAutoFailover(v); setGlobalPending(true); }}
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
                onCheckedChange={(v) => { setGlobalParallelEnabled(v); setGlobalPending(true); }}
              />
            </div>
          </div>

          <Button
            className="w-full"
            size="sm"
            onClick={handleApplyGlobal}
            disabled={!defaultTarget}
          >
            <Globe className="h-4 w-4 mr-2" />
            应用到所有功能
          </Button>
          {globalPending && (
            <p className="text-xs text-amber-600 text-center">
              设置已修改但尚未应用，请点击上方按钮将配置推送到各功能模块
            </p>
          )}
        </div>

        <div className="space-y-3 mt-6">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <span>各功能模块</span>
            <span className="text-xs">（点击展开可单独调整）</span>
          </h3>

          {configurableRoutingModules.map((moduleRoute) => {
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
                  onClick={() => toggleModuleExpand(moduleRoute.moduleId)}
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
                      <Badge variant="default" className="text-[10px] shrink-0 bg-amber-600">
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
                          setDeleteModuleConfirmId(moduleRoute.moduleId);
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
                      <ModelSelector
                        label="主用模型"
                        help="优先使用的 AI 模型"
                        target={moduleRoute.primaryTarget}
                        providers={providers}
                        allowEmpty
                        onChange={(target) =>
                          patchModule(moduleRoute.moduleId, {
                            primaryTarget: target,
                            parallelTargets:
                              moduleRoute.parallelTargets.length > 0
                                ? moduleRoute.parallelTargets
                                : target
                                ? [target]
                                : [],
                          })
                        }
                      />
                      <ModelSelector
                        label="备用模型"
                        help="主用模型不可用时自动切换至此模型"
                        target={moduleRoute.backupTarget}
                        providers={providers}
                        allowEmpty
                        onChange={(target) =>
                          patchModule(moduleRoute.moduleId, {
                            backupTarget: target,
                            currentMode: !target && moduleRoute.currentMode === "backup" ? "primary" : moduleRoute.currentMode,
                          })
                        }
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
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Input
            value={newModuleLabel}
            onChange={(e) => setNewModuleLabel(e.target.value)}
            placeholder="自定义模块名称"
            className="max-w-xs"
          />
          <Button variant="outline" size="sm" onClick={handleAddCustomModule}>
            <Plus className="h-4 w-4 mr-1" />
            添加自定义模块
          </Button>
        </div>
      </SettingsSection>

      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除这个服务商吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmId) void handleDeleteProvider(deleteConfirmId);
              }}
              disabled={saving}
            >
              {saving ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteModuleConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteModuleConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除这个自定义模块吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteModuleConfirmId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteModuleConfirmId) handleRemoveCustomModule(deleteModuleConfirmId);
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

export function ProviderCard({
  provider,
  isEditing,
  formData,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onSetActive,
  onFormChange,
}: {
  provider: AiProviderConfig;
  isEditing: boolean;
  formData: Partial<AiProviderConfig>;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onSetActive: () => void;
  onFormChange: (data: Partial<AiProviderConfig>) => void;
}) {
  const providerTypeLabels: Record<AiProviderType, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    custom: "自定义",
  };

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
            </div>
            <p className="text-xs text-muted-foreground">
              {providerTypeLabels[provider.provider]} · {provider.models.length} 个模型
            </p>
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
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="mt-4 pt-4 border-t space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">显示名称</Label>
              <Input
                value={formData.name ?? ""}
                onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
                placeholder="例如：OpenAI 官方"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">服务商类型</Label>
              <Select
                value={formData.provider ?? "openai"}
                onValueChange={(v) => onFormChange({ ...formData, provider: v as AiProviderType })}
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
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">模型列表（用逗号分隔）</Label>
              <Input
                value={formData.models?.join(", ") ?? ""}
                onChange={(e) =>
                  onFormChange({
                    ...formData,
                    models: e.target.value.split(",").map((m) => m.trim()).filter(Boolean),
                  })
                }
                placeholder="gpt-4o, gpt-4o-mini, claude-3-opus"
              />
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
