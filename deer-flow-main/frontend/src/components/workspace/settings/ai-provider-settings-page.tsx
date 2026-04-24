"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Globe,
  Key,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAiProviderStore,
  type AiProviderConfig,
  type AiProviderType,
} from "@/core/ai/ai-provider-store";
import {
  appendSwitchLog,
  buildModelTargetKey,
  BUILTIN_FEATURE_MODULES,
  createCustomModuleRoute,
  getProviderDisplayName,
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
  saveFeatureRoutingState,
  type AiChannelBillingMode,
  type AiChannelStatus,
  type AiFeatureModuleRoute,
  type AiFeatureRoutingState,
  type AiModelTarget,
  type AiParallelStrategy,
  type AiRouteMode,
} from "@/core/ai/feature-routing";
import { globalAiService } from "@/core/ai/global-ai-service";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

const NONE_VALUE = "__none__";
const AUTO_SWEEP_INTERVAL_MS = 120000;

const CHANNEL_STATUS_LABELS: Record<AiChannelStatus, string> = {
  online: "可用",
  degraded: "降级",
  offline: "不可用",
};

const CHANNEL_STATUS_BADGE: Record<AiChannelStatus, string> = {
  online: "bg-emerald-600 text-white",
  degraded: "bg-amber-500 text-amber-950",
  offline: "bg-rose-600 text-white",
};

const CATEGORY_LABELS: Record<AiFeatureModuleRoute["category"], string> = {
  workspace: "主项目",
  agent: "智能体",
  novel: "小说",
  custom: "自定义",
};

const ROUTE_MODE_LABELS: Record<AiRouteMode, string> = {
  primary: "当前在用：主模型",
  backup: "已切换：备用模型",
};

const ROUTE_MODE_BADGE: Record<AiRouteMode, string> = {
  primary: "bg-emerald-600 text-white",
  backup: "bg-amber-500 text-amber-950",
};

interface ModuleHealthState {
  checking: boolean;
  healthy?: boolean;
  message?: string;
  checkedAt?: string;
}

interface ParallelResultItem {
  target: AiModelTarget;
  providerName: string;
  latency: number;
  content?: string;
  error?: string;
}

interface ParallelRunState {
  running: boolean;
  startedAt: string;
  strategy: AiParallelStrategy;
  results: ParallelResultItem[];
  selectedIndex?: number;
  fusedContent?: string;
}

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

function formatTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "-";
  }

  return timestamp.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function scoreParallelResult(item: ParallelResultItem): number {
  if (item.error) {
    return -1000;
  }
  const contentScore = (item.content?.trim().length ?? 0) / 10;
  const latencyScore = Math.max(0, 5000 - item.latency) / 100;
  return contentScore + latencyScore;
}

function getPrimaryTarget(moduleRoute: AiFeatureModuleRoute): AiModelTarget | null {
  if (moduleRoute.currentMode === "backup" && moduleRoute.backupTarget) {
    return moduleRoute.backupTarget;
  }
  return moduleRoute.primaryTarget;
}

function ChannelModelSelector({
  title,
  help,
  target,
  providers,
  allowEmpty,
  onChange,
}: {
  title: string;
  help: string;
  target: AiModelTarget | null;
  providers: AiProviderConfig[];
  allowEmpty?: boolean;
  onChange: (next: AiModelTarget | null) => void;
}) {
  const selectedProviderId = target?.providerId ?? NONE_VALUE;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedModel =
    selectedProvider && target?.model && selectedProvider.models.includes(target.model)
      ? target.model
      : NONE_VALUE;
  const selectedProviderLabel = selectedProvider?.name ?? "选择渠道";
  const selectedModelLabel = selectedModel !== NONE_VALUE ? selectedModel : "选择模型";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label className="text-xs">{title}</Label>
        <HelpTip text={help} />
      </div>
      <div className="grid min-w-0 gap-2 md:grid-cols-2">
        <Select
          value={selectedProviderId}
          onValueChange={(value) => {
            if (value === NONE_VALUE) {
              if (allowEmpty) {
                onChange(null);
              }
              return;
            }

            const provider = providers.find((item) => item.id === value);
            if (!provider || provider.models.length === 0) {
              onChange(null);
              return;
            }

            const nextModel = provider.models[0]!;
            onChange({ providerId: provider.id, model: nextModel });
          }}
        >
          <SelectTrigger className="h-8 w-full min-w-0" title={selectedProviderLabel}>
            <SelectValue className="min-w-0 truncate" placeholder="选择渠道" />
          </SelectTrigger>
          <SelectContent>
            {allowEmpty && <SelectItem value={NONE_VALUE}>未设置</SelectItem>}
            {providers.map((provider) => (
              <SelectItem
                key={provider.id}
                value={provider.id}
                disabled={provider.models.length === 0}
                className="max-w-full truncate"
                title={`${provider.name}${provider.models.length === 0 ? "（无模型）" : ""}`}
              >
                {provider.name}
                {provider.models.length === 0 ? "（无模型）" : ""}
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
          <SelectTrigger className="h-8 w-full min-w-0" title={selectedModelLabel}>
            <SelectValue className="min-w-0 truncate" placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent>
            {allowEmpty && <SelectItem value={NONE_VALUE}>未设置</SelectItem>}
            {selectedProvider?.models.map((model) => (
              <SelectItem key={model} value={model} className="max-w-full truncate" title={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

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
    saveFeatureRoutingToServer,
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
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const [routingDraft, setRoutingDraft] = useState<AiFeatureRoutingState | null>(null);
  const [routingEffective, setRoutingEffective] = useState<AiFeatureRoutingState | null>(null);
  const [routingDirty, setRoutingDirty] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingNotice, setRoutingNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [newModuleLabel, setNewModuleLabel] = useState("");
  const [newModuleDescription, setNewModuleDescription] = useState("");
  const [parallelPrompt, setParallelPrompt] = useState(
    "请基于高可用要求，给出一句话的 AI 路由建议。"
  );

  const [healthByModule, setHealthByModule] = useState<Record<string, ModuleHealthState>>({});
  const [parallelByModule, setParallelByModule] = useState<Record<string, ParallelRunState>>({});

  const routingDraftRef = useRef<AiFeatureRoutingState | null>(null);
  const autoSweepRunningRef = useRef(false);

  useEffect(() => {
    routingDraftRef.current = routingDraft;
  }, [routingDraft]);

  useEffect(() => {
    ensureHydrated().catch(() => undefined);
  }, [ensureHydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const backendOrLocal =
      draft.featureRoutingSettings ?? loadFeatureRoutingState(draft.providers);
    const normalizedEffective = normalizeFeatureRoutingState(backendOrLocal, draft.providers);

    setRoutingEffective(normalizedEffective);
    setRoutingDraft((prev) => {
      if (routingDirty && prev) {
        return normalizeFeatureRoutingState(prev, draft.providers);
      }
      return normalizedEffective;
    });
  }, [hydrated, draft.featureRoutingSettings, draft.providers, routingDirty]);

  const providers = draft.providers;

  const enabledBuiltinModuleCount = useMemo(
    () => BUILTIN_FEATURE_MODULES.length,
    []
  );
  const runtimeReadyBuiltinModuleCount = useMemo(
    () => BUILTIN_FEATURE_MODULES.filter((moduleDef) => moduleDef.runtimeReady).length,
    []
  );

  const mutateRoutingDraft = useCallback(
    (updater: (state: AiFeatureRoutingState) => AiFeatureRoutingState) => {
      setRoutingDraft((prev) => {
        if (!prev) {
          return prev;
        }
        const next = normalizeFeatureRoutingState(updater(prev), providers);
        return next;
      });
      setRoutingDirty(true);
      setRoutingNotice(null);
    },
    [providers]
  );

  const handleSave = useCallback(async () => {
    if (editingId) {
      updateProvider(editingId, formData);
      setSaving(true);
      setSaveError(null);
      setSaveSuccess(null);
      try {
        await saveDraftToServer();
        setEditingId(null);
        setFormData({});
        setSaveSuccess("供应商配置已保存");
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
      setSaveSuccess(null);
      try {
        await saveDraftToServer();
        setSaveSuccess("供应商已删除并保存");
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
      setSaveSuccess(null);
      try {
        await saveDraftToServer();
        setSaveSuccess("默认供应商切换成功");
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

  const handleTestConnection = useCallback(
    async (id: string) => {
      setTestingId(id);
      setTestResult(null);

      setSaving(true);
      setSaveError(null);
      try {
        if (isDirty) {
          await saveDraftToServer();
          setSaveSuccess("已先保存供应商配置，再执行连接测试");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "保存失败，无法测试连接";
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
    },
    [isDirty, saveDraftToServer]
  );

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
      setSaveSuccess("基础供应商配置已导出");
    } catch (error) {
      console.error("导出配置失败:", error);
      setSaveError("导出失败，请重试");
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
          setSaveSuccess("基础供应商配置导入成功，请点击保存更改写回后端");
        } else {
          setSaveError("配置文件格式错误，导入失败");
        }
      } catch (error) {
        console.error("导入配置失败:", error);
        setSaveError("读取文件失败");
      }
    };

    input.click();
  }, [importConfig]);

  const handleRoutingChannelChange = useCallback(
    (
      providerId: string,
      patch: Partial<{
        billingMode: AiChannelBillingMode;
        region: string;
        status: AiChannelStatus;
      }>
    ) => {
      mutateRoutingDraft((state) => ({
        ...state,
        channels: state.channels.map((channel) =>
          channel.providerId === providerId
            ? {
                ...channel,
                ...patch,
              }
            : channel
        ),
      }));
    },
    [mutateRoutingDraft]
  );

  const handleRoutingDefaultTargetChange = useCallback(
    (target: AiModelTarget | null) => {
      mutateRoutingDraft((state) => ({
        ...state,
        defaultTarget: target,
        modules: state.modules.map((moduleRoute) => {
          if (moduleRoute.defaultTarget) {
            return moduleRoute;
          }
          return {
            ...moduleRoute,
            defaultTarget: target,
            primaryTarget: moduleRoute.primaryTarget ?? target,
            parallelTargets:
              moduleRoute.parallelTargets.length > 0
                ? moduleRoute.parallelTargets
                : target
                ? [target]
                : [],
          };
        }),
      }));
    },
    [mutateRoutingDraft]
  );

  const patchModuleRoute = useCallback(
    (moduleId: string, patch: Partial<AiFeatureModuleRoute>) => {
      mutateRoutingDraft((state) => ({
        ...state,
        modules: state.modules.map((moduleRoute) =>
          moduleRoute.moduleId === moduleId
            ? {
                ...moduleRoute,
                ...patch,
              }
            : moduleRoute
        ),
      }));
    },
    [mutateRoutingDraft]
  );

  const switchModuleMode = useCallback(
    (
      moduleId: string,
      toMode: AiRouteMode,
      reason: string,
      automatic: boolean
    ) => {
      mutateRoutingDraft((state) => {
        const current = state.modules.find((moduleRoute) => moduleRoute.moduleId === moduleId);
        if (!current || current.currentMode === toMode) {
          return state;
        }

        const nextModules = state.modules.map((moduleRoute) =>
          moduleRoute.moduleId === moduleId
            ? {
                ...moduleRoute,
                currentMode: toMode,
              }
            : moduleRoute
        );

        return appendSwitchLog(
          {
            ...state,
            modules: nextModules,
          },
          {
            moduleId,
            moduleLabel: current.moduleLabel,
            fromMode: current.currentMode,
            toMode,
            reason,
            automatic,
          }
        );
      });
    },
    [mutateRoutingDraft]
  );

  const probeModelTarget = useCallback(
    async (target: AiModelTarget): Promise<{ success: boolean; latency: number; message: string }> => {
      const startedAt = Date.now();
      try {
        await globalAiService.chat({
          messages: [{ role: "user", content: "health check" }],
          providerId: target.providerId,
          model: target.model,
          stream: false,
          temperature: 0,
          maxTokens: 16,
        });
        const latency = Date.now() - startedAt;
        return {
          success: true,
          latency,
          message: `主模型可用（${latency}ms）`,
        };
      } catch (err) {
        const latency = Date.now() - startedAt;
        return {
          success: false,
          latency,
          message: err instanceof Error ? err.message : "探活失败",
        };
      }
    },
    []
  );

  const handleCheckPrimaryTarget = useCallback(
    async (moduleRoute: AiFeatureModuleRoute) => {
      if (!moduleRoute.primaryTarget) {
        setRoutingNotice({ type: "error", message: `模块「${moduleRoute.moduleLabel}」未设置主模型` });
        return;
      }

      setHealthByModule((prev) => ({
        ...prev,
        [moduleRoute.moduleId]: {
          checking: true,
          checkedAt: prev[moduleRoute.moduleId]?.checkedAt,
          healthy: prev[moduleRoute.moduleId]?.healthy,
          message: "探活中...",
        },
      }));

      const result = await probeModelTarget(moduleRoute.primaryTarget);
      const checkedAt = new Date().toISOString();

      setHealthByModule((prev) => ({
        ...prev,
        [moduleRoute.moduleId]: {
          checking: false,
          healthy: result.success,
          checkedAt,
          message: result.message,
        },
      }));

      if (!result.success && moduleRoute.autoFailover && moduleRoute.backupTarget) {
        switchModuleMode(moduleRoute.moduleId, "backup", `主模型探活失败：${result.message}`, true);
        setRoutingNotice({
          type: "error",
          message: `模块「${moduleRoute.moduleLabel}」主模型异常，已自动切换到备用模型`,
        });
      }
    },
    [probeModelTarget, switchModuleMode]
  );

  const runAutoHealthSweep = useCallback(async () => {
    if (autoSweepRunningRef.current) {
      return;
    }

    const snapshot = routingDraftRef.current;
    if (!snapshot) {
      return;
    }

    const candidates = snapshot.modules.filter(
      (moduleRoute) =>
        moduleRoute.autoFailover && Boolean(moduleRoute.primaryTarget) && Boolean(moduleRoute.backupTarget)
    );

    if (candidates.length === 0) {
      return;
    }

    autoSweepRunningRef.current = true;
    try {
      for (const moduleRoute of candidates) {
        const primaryTarget = moduleRoute.primaryTarget;
        if (!primaryTarget) {
          continue;
        }

        const result = await probeModelTarget(primaryTarget);
        const checkedAt = new Date().toISOString();

        setHealthByModule((prev) => ({
          ...prev,
          [moduleRoute.moduleId]: {
            checking: false,
            healthy: result.success,
            checkedAt,
            message: `自动探活：${result.message}`,
          },
        }));

        if (!result.success && moduleRoute.currentMode !== "backup" && moduleRoute.backupTarget) {
          switchModuleMode(moduleRoute.moduleId, "backup", `自动探活失败：${result.message}`, true);
        }
      }
    } finally {
      autoSweepRunningRef.current = false;
    }
  }, [probeModelTarget, switchModuleMode]);

  useEffect(() => {
    if (!routingDraft) {
      return;
    }

    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void runAutoHealthSweep();
    }, AUTO_SWEEP_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [routingDraft, runAutoHealthSweep]);

  const runParallelForModule = useCallback(
    async (moduleRoute: AiFeatureModuleRoute) => {
      if (!moduleRoute.parallelEnabled) {
        setRoutingNotice({ type: "error", message: `请先为「${moduleRoute.moduleLabel}」开启多模型并行` });
        return;
      }

      if (moduleRoute.parallelTargets.length === 0) {
        setRoutingNotice({ type: "error", message: `请先勾选「${moduleRoute.moduleLabel}」的并行模型` });
        return;
      }

      setParallelByModule((prev) => ({
        ...prev,
        [moduleRoute.moduleId]: {
          running: true,
          startedAt: new Date().toISOString(),
          strategy: moduleRoute.parallelStrategy,
          results: [],
        },
      }));

      const results = await Promise.all(
        moduleRoute.parallelTargets.map(async (target): Promise<ParallelResultItem> => {
          const startedAt = Date.now();
          try {
            const content = await globalAiService.chat({
              messages: [{ role: "user", content: parallelPrompt }],
              providerId: target.providerId,
              model: target.model,
              stream: false,
            });

            return {
              target,
              providerName: getProviderDisplayName(providers, target.providerId),
              latency: Date.now() - startedAt,
              content,
            };
          } catch (err) {
            return {
              target,
              providerName: getProviderDisplayName(providers, target.providerId),
              latency: Date.now() - startedAt,
              error: err instanceof Error ? err.message : "并行调用失败",
            };
          }
        })
      );

      let selectedIndex: number | undefined;
      let fusedContent: string | undefined;

      if (moduleRoute.parallelStrategy === "auto") {
        const sorted = results
          .map((item, index) => ({ index, score: scoreParallelResult(item) }))
          .sort((a, b) => b.score - a.score);
        selectedIndex = sorted[0]?.index;
      }

      if (moduleRoute.parallelStrategy === "fusion") {
        const successful = results.filter((item) => !item.error && item.content?.trim());
        fusedContent =
          successful.length > 0
            ? successful
                .map(
                  (item, index) =>
                    `【模型${index + 1} ${item.providerName}/${item.target.model}】\n${item.content}`
                )
                .join("\n\n")
            : "无可融合的有效结果";
      }

      setParallelByModule((prev) => ({
        ...prev,
        [moduleRoute.moduleId]: {
          running: false,
          startedAt: new Date().toISOString(),
          strategy: moduleRoute.parallelStrategy,
          results,
          selectedIndex,
          fusedContent,
        },
      }));
    },
    [parallelPrompt, providers]
  );

  const handleSaveRouting = useCallback(async () => {
    if (!routingDraft) {
      return;
    }

    setRoutingSaving(true);
    setRoutingNotice(null);
    try {
      const normalized = normalizeFeatureRoutingState(routingDraft, providers);
      saveFeatureRoutingState(normalized);
      const persisted = await saveFeatureRoutingToServer(normalized);
      const nextState = normalizeFeatureRoutingState(persisted ?? normalized, providers);
      setRoutingDraft(nextState);
      setRoutingEffective(nextState);
      setRoutingDirty(false);
      setRoutingNotice({
        type: "success",
        message: "高级路由配置已保存（后端持久化，当前浏览器同步缓存）",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "高级路由配置保存失败";
      setRoutingNotice({ type: "error", message });
    } finally {
      setRoutingSaving(false);
    }
  }, [providers, routingDraft, saveFeatureRoutingToServer]);

  const handleCancelRouting = useCallback(() => {
    if (!routingEffective) {
      return;
    }

    const normalized = normalizeFeatureRoutingState(routingEffective, providers);
    setRoutingDraft(normalized);
    setRoutingDirty(false);
    setRoutingNotice(null);
    setHealthByModule({});
    setParallelByModule({});
  }, [providers, routingEffective]);

  const handleAddCustomModule = useCallback(() => {
    const label = newModuleLabel.trim();
    if (!label) {
      setRoutingNotice({ type: "error", message: "请先填写自定义模块名称" });
      return;
    }

    mutateRoutingDraft((state) => ({
      ...state,
      modules: [
        ...state.modules,
        createCustomModuleRoute(
          label,
          newModuleDescription,
          providers,
          state.defaultTarget
        ),
      ],
    }));

    setNewModuleLabel("");
    setNewModuleDescription("");
  }, [mutateRoutingDraft, newModuleDescription, newModuleLabel, providers]);

  const handleRemoveCustomModule = useCallback(
    (moduleId: string) => {
      mutateRoutingDraft((state) => ({
        ...state,
        modules: state.modules.filter((moduleRoute) => moduleRoute.moduleId !== moduleId),
        switchLogs: state.switchLogs.filter((log) => log.moduleId !== moduleId),
      }));
      setParallelByModule((prev) => {
        const next = { ...prev };
        delete next[moduleId];
        return next;
      });
      setHealthByModule((prev) => {
        const next = { ...prev };
        delete next[moduleId];
        return next;
      });
    },
    [mutateRoutingDraft]
  );

  const routingModules = routingDraft?.modules ?? [];

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

      {saveSuccess && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>操作成功</AlertTitle>
          <AlertDescription>{saveSuccess}</AlertDescription>
        </Alert>
      )}

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>权限提示</AlertTitle>
        <AlertDescription>
          当前前端尚未接入角色鉴权上下文，页面默认对可进入设置页的用户可见。建议后续联动后端角色（系统管理员/AI配置管理员）做显示与写入权限控制。
        </AlertDescription>
      </Alert>

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
                    setSaveSuccess(null);
                    refreshFromServer().catch((err) => {
                      const message = err instanceof Error ? err.message : "刷新失败";
                      setSaveError(message);
                    });
                  }}
                  disabled={hydrating || saving}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-1", hydrating && "animate-spin")} />
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
                    onCancel={() => {
                      setEditingId(null);
                      setFormData({});
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

      <SettingsSection title="渠道管理" description="为各渠道补充计费方式、地域和可用状态，辅助模型路由决策">
        <Card>
          <CardContent className="pt-6 space-y-4">
            {!routingDraft ? (
              <p className="text-sm text-muted-foreground">正在加载渠道配置...</p>
            ) : draft.providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">请先添加至少一个供应商，渠道将自动基于供应商创建。</p>
            ) : (
              <div className="space-y-3">
                {draft.providers.map((provider) => {
                  const channel = routingDraft.channels.find((item) => item.providerId === provider.id);
                  if (!channel) {
                    return null;
                  }
                  return (
                    <div key={provider.id} className="rounded-lg border p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={provider.name}>
                            {provider.name}
                          </p>
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={`${provider.provider} · ${provider.models.length} 个模型`}
                          >
                            {provider.provider} · {provider.models.length} 个模型
                          </p>
                        </div>
                        <Badge className={cn("shrink-0", CHANNEL_STATUS_BADGE[channel.status])}>
                          {CHANNEL_STATUS_LABELS[channel.status]}
                        </Badge>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs">计费方式</Label>
                            <HelpTip text="用于说明该渠道主要的成本口径，便于管理员做成本决策。" />
                          </div>
                          <Select
                            value={channel.billingMode}
                            onValueChange={(value) =>
                              handleRoutingChannelChange(provider.id, {
                                billingMode: value as AiChannelBillingMode,
                              })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="token">按 Token</SelectItem>
                              <SelectItem value="request">按请求</SelectItem>
                              <SelectItem value="subscription">订阅制</SelectItem>
                              <SelectItem value="hybrid">混合计费</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs">地域</Label>
                            <HelpTip text="用于标识渠道的主要部署地域，可作为延迟与合规选择参考。" />
                          </div>
                          <Input
                            value={channel.region}
                            onChange={(e) =>
                              handleRoutingChannelChange(provider.id, { region: e.target.value })
                            }
                            placeholder="例如：east-us / cn-hangzhou"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs">当前可用状态</Label>
                            <HelpTip text="该状态用于管理视图，不会覆盖实时探活结果。" />
                          </div>
                          <Select
                            value={channel.status}
                            onValueChange={(value) =>
                              handleRoutingChannelChange(provider.id, {
                                status: value as AiChannelStatus,
                              })
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="online">可用</SelectItem>
                              <SelectItem value="degraded">降级</SelectItem>
                              <SelectItem value="offline">不可用</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="功能模块模型路由"
        description="按项目真实功能独立配置默认/主备模型，并支持多模型并行策略"
      >
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">路由配置</CardTitle>
                <CardDescription>
                  已内置 {enabledBuiltinModuleCount} 个项目模块，其中{" "}
                  {runtimeReadyBuiltinModuleCount} 个已接入运行链路（主对话、智能体、小说对话/大纲/章节 AI），其余模块可先行预配置。
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelRouting}
                  disabled={!routingDirty || routingSaving}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSaveRouting()}
                  disabled={!routingDirty || routingSaving}
                >
                  {routingSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" />
                      保存高级配置
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {routingNotice && (
              <Alert variant={routingNotice.type === "error" ? "destructive" : "default"}>
                {routingNotice.type === "error" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                )}
                <AlertTitle>{routingNotice.type === "error" ? "操作失败" : "操作成功"}</AlertTitle>
                <AlertDescription>{routingNotice.message}</AlertDescription>
              </Alert>
            )}

            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>当前持久化边界</AlertTitle>
              <AlertDescription>
                高级路由配置（功能模块主备/并行/日志/渠道元数据）会写入后端 `/api/user/ai-settings` 的
                `feature_routing_settings`，并在当前浏览器保留一份本地缓存用于回退。
              </AlertDescription>
            </Alert>

            {routingDraft && (
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">默认模型</p>
                  <HelpTip text="新增模块时会自动继承该默认渠道+模型，管理员可再单独覆盖。" />
                </div>
                <ChannelModelSelector
                  title="默认渠道 + 默认模型"
                  help="先选渠道，再选该渠道下模型。"
                  target={routingDraft.defaultTarget}
                  providers={providers}
                  allowEmpty
                  onChange={handleRoutingDefaultTargetChange}
                />
              </div>
            )}

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">新增自定义模块</p>
                <HelpTip text="用于补充内置模块之外的业务功能，每个模块可独立配置模型路由。" />
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={newModuleLabel}
                  onChange={(e) => setNewModuleLabel(e.target.value)}
                  placeholder="模块名称，例如：工具调用摘要"
                />
                <Input
                  value={newModuleDescription}
                  onChange={(e) => setNewModuleDescription(e.target.value)}
                  placeholder="模块描述（可选）"
                />
                <Button variant="outline" onClick={handleAddCustomModule}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加模块
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {routingModules.map((moduleRoute) => {
                const activeTarget = getPrimaryTarget(moduleRoute);
                const health = healthByModule[moduleRoute.moduleId];
                const runState = parallelByModule[moduleRoute.moduleId];
                const latestSwitchLog = routingDraft?.switchLogs.find(
                  (log) => log.moduleId === moduleRoute.moduleId
                );
                const isCustomModule = moduleRoute.category === "custom";

                return (
                  <Card key={moduleRoute.moduleId}>
                    <CardHeader className="pb-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="text-base">{moduleRoute.moduleLabel}</CardTitle>
                            <Badge variant="outline">{CATEGORY_LABELS[moduleRoute.category]}</Badge>
                            <Badge
                              variant={moduleRoute.runtimeReady ? "default" : "secondary"}
                              className={moduleRoute.runtimeReady ? "bg-emerald-600 text-white" : undefined}
                            >
                              {moduleRoute.runtimeReady ? "运行已接入" : "待接入"}
                            </Badge>
                            <Badge className={ROUTE_MODE_BADGE[moduleRoute.currentMode]}>
                              {ROUTE_MODE_LABELS[moduleRoute.currentMode]}
                            </Badge>
                          </div>
                          <CardDescription>{moduleRoute.moduleDescription}</CardDescription>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleCheckPrimaryTarget(moduleRoute)}
                            disabled={Boolean(health?.checking) || !moduleRoute.primaryTarget}
                          >
                            {health?.checking ? (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                                探活中
                              </>
                            ) : (
                              <>
                                <Zap className="h-3.5 w-3.5 mr-1" />
                                探活主模型
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              switchModuleMode(moduleRoute.moduleId, "primary", "管理员手动切回主模型", false)
                            }
                            disabled={!moduleRoute.primaryTarget || moduleRoute.currentMode === "primary"}
                          >
                            切到主模型
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              switchModuleMode(moduleRoute.moduleId, "backup", "管理员手动切换到备用模型", false)
                            }
                            disabled={!moduleRoute.backupTarget || moduleRoute.currentMode === "backup"}
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
                            切到备用
                          </Button>
                          {isCustomModule && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleRemoveCustomModule(moduleRoute.moduleId)}
                              title="删除自定义模块"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      <div className="grid gap-3 lg:grid-cols-3">
                        <ChannelModelSelector
                          title="模块默认模型"
                          help="模块新增时默认使用的渠道+模型。"
                          target={moduleRoute.defaultTarget}
                          providers={providers}
                          allowEmpty
                          onChange={(target) =>
                            patchModuleRoute(moduleRoute.moduleId, {
                              defaultTarget: target,
                            })
                          }
                        />

                        <ChannelModelSelector
                          title="主模型"
                          help="系统优先使用该渠道+模型执行请求。"
                          target={moduleRoute.primaryTarget}
                          providers={providers}
                          allowEmpty
                          onChange={(target) =>
                            patchModuleRoute(moduleRoute.moduleId, {
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

                        <ChannelModelSelector
                          title="备用模型"
                          help="主模型异常时自动或手动切换到该模型。"
                          target={moduleRoute.backupTarget}
                          providers={providers}
                          allowEmpty
                          onChange={(target) =>
                            patchModuleRoute(moduleRoute.moduleId, {
                              backupTarget: target,
                              currentMode:
                                !target && moduleRoute.currentMode === "backup"
                                  ? "primary"
                                  : moduleRoute.currentMode,
                            })
                          }
                        />
                      </div>

                      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_260px]">
                        <div className="flex items-center justify-between rounded-md border p-3">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <p className="text-sm font-medium">自动主备切换</p>
                              <HelpTip text="定时探活主模型失败时，自动切到备用模型并记录日志。" />
                            </div>
                            <p className="text-xs text-muted-foreground">每 2 分钟自动探活一次</p>
                          </div>
                          <Switch
                            checked={moduleRoute.autoFailover}
                            onCheckedChange={(checked) =>
                              patchModuleRoute(moduleRoute.moduleId, {
                                autoFailover: checked,
                              })
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between rounded-md border p-3">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <p className="text-sm font-medium">多模型并行</p>
                              <HelpTip text="开启后可同时请求多个模型，并按策略输出结果。" />
                            </div>
                            <p className="text-xs text-muted-foreground">支持对比/自动择优/融合</p>
                          </div>
                          <Switch
                            checked={moduleRoute.parallelEnabled}
                            onCheckedChange={(checked) =>
                              patchModuleRoute(moduleRoute.moduleId, {
                                parallelEnabled: checked,
                              })
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <Label className="text-xs">并行策略</Label>
                            <HelpTip text="对比：展示全部结果；自动择优：按速度与内容质量评分选一条；融合：合并多模型结果。" />
                          </div>
                          <Select
                            value={moduleRoute.parallelStrategy}
                            onValueChange={(value) =>
                              patchModuleRoute(moduleRoute.moduleId, {
                                parallelStrategy: value as AiParallelStrategy,
                              })
                            }
                            disabled={!moduleRoute.parallelEnabled}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="compare">对比模式</SelectItem>
                              <SelectItem value="auto">自动择优</SelectItem>
                              <SelectItem value="fusion">多模型融合</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {moduleRoute.parallelEnabled && (
                        <div className="rounded-md border p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1">
                                <p className="text-sm font-medium">并行模型清单</p>
                                <HelpTip text="勾选该模块并行调用的模型，结果会标注“渠道+模型”来源。" />
                              </div>
                              <p className="text-xs text-muted-foreground">至少勾选一个模型</p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void runParallelForModule(moduleRoute)}
                              disabled={Boolean(runState?.running) || moduleRoute.parallelTargets.length === 0}
                            >
                              {runState?.running ? (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                                  并行运行中
                                </>
                              ) : (
                                <>
                                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                                  运行并行测试
                                </>
                              )}
                            </Button>
                          </div>

                          <div className="grid gap-2 md:grid-cols-2">
                            {providers.flatMap((provider) =>
                              provider.models.map((model) => {
                                const key = buildModelTargetKey({ providerId: provider.id, model });
                                const checked = moduleRoute.parallelTargets.some(
                                  (target) => buildModelTargetKey(target) === key
                                );
                                return (
                                  <label
                                    key={key}
                                    className="flex min-w-0 items-center gap-2 overflow-hidden rounded border px-2.5 py-2 text-sm"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(nextChecked) => {
                                        const nextTargets = nextChecked
                                          ? [...moduleRoute.parallelTargets, { providerId: provider.id, model }]
                                          : moduleRoute.parallelTargets.filter(
                                              (target) => buildModelTargetKey(target) !== key
                                            );
                                        patchModuleRoute(moduleRoute.moduleId, {
                                          parallelTargets: nextTargets,
                                        });
                                      }}
                                    />
                                    <span
                                      className="min-w-0 flex-1 truncate"
                                      title={`${provider.name} / ${model}`}
                                    >
                                      {provider.name} / {model}
                                    </span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}

                      <div className="rounded-md border p-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={ROUTE_MODE_BADGE[moduleRoute.currentMode]}>
                            {ROUTE_MODE_LABELS[moduleRoute.currentMode]}
                          </Badge>
                          <span
                            className="text-xs text-muted-foreground min-w-0 break-all"
                            title={
                              activeTarget
                                ? `${getProviderDisplayName(providers, activeTarget.providerId)} / ${activeTarget.model}`
                                : "未设置"
                            }
                          >
                            当前模型：
                            {activeTarget
                              ? `${getProviderDisplayName(providers, activeTarget.providerId)} / ${activeTarget.model}`
                              : "未设置"}
                          </span>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          最近探活：
                          {health?.checkedAt ? `${formatTime(health.checkedAt)} · ${health.message}` : "暂无探活记录"}
                        </p>

                        <p className="text-xs text-muted-foreground">
                          最近切换：
                          {latestSwitchLog
                            ? `${formatTime(latestSwitchLog.switchedAt)} · ${latestSwitchLog.automatic ? "自动" : "手动"} · ${latestSwitchLog.reason}`
                            : "暂无切换记录"}
                        </p>
                      </div>

                      {runState && (
                        <div className="rounded-md border p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">
                              并行结果（{runState.strategy === "compare"
                                ? "对比模式"
                                : runState.strategy === "auto"
                                ? "自动择优"
                                : "多模型融合"}
                              ）
                            </p>
                            <p className="text-xs text-muted-foreground">
                              <Clock3 className="inline h-3.5 w-3.5 mr-1" />
                              {formatTime(runState.startedAt)}
                            </p>
                          </div>

                          {runState.strategy === "fusion" && runState.fusedContent && (
                            <div className="rounded-md border bg-muted/30 p-3">
                              <p className="text-xs text-muted-foreground mb-1">融合输出</p>
                              <p className="text-sm whitespace-pre-wrap break-all">{runState.fusedContent}</p>
                            </div>
                          )}

                          <div className="grid gap-2 md:grid-cols-2">
                            {runState.results.map((item, index) => (
                              <div
                                key={`${item.target.providerId}-${item.target.model}-${index}`}
                                className="rounded-md border p-3 space-y-2"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className="max-w-full"
                                    title={`${item.providerName} / ${item.target.model}`}
                                  >
                                    <span className="truncate">
                                      {item.providerName} / {item.target.model}
                                    </span>
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">{item.latency}ms</span>
                                  {runState.strategy === "auto" && runState.selectedIndex === index && (
                                    <Badge className="bg-emerald-600 text-white">自动选中</Badge>
                                  )}
                                </div>
                                {item.error ? (
                                  <p className="text-xs text-destructive">{item.error}</p>
                                ) : (
                                  <p className="text-sm whitespace-pre-wrap">
                                    {item.content && item.content.length > 0 ? item.content : "（空结果）"}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center gap-1">
                <p className="text-sm font-medium">并行测试提示词</p>
                <HelpTip text="该提示词用于“运行并行测试”按钮，便于你在同页面对比多模型输出。" />
              </div>
              <Textarea
                value={parallelPrompt}
                onChange={(e) => setParallelPrompt(e.target.value)}
                className="min-h-20"
              />
            </div>

            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">最近切换日志</p>
                <HelpTip text="展示最近的主备切换（自动或手动），用于故障追踪和审计。" />
              </div>

              {routingDraft?.switchLogs.length ? (
                <div className="space-y-2">
                  {routingDraft.switchLogs.slice(0, 8).map((log) => (
                    <div key={log.id} className="rounded border px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="max-w-full" title={log.moduleLabel}>
                          <span className="truncate">{log.moduleLabel}</span>
                        </Badge>
                        <Badge className={log.automatic ? "bg-amber-500 text-amber-950" : "bg-emerald-600 text-white"}>
                          {log.automatic ? "自动" : "手动"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(log.switchedAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.fromMode === "primary" ? "主模型" : "备用模型"} → {log.toMode === "primary" ? "主模型" : "备用模型"}
                        {` · ${log.reason}`}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无切换日志</p>
              )}
            </div>
          </CardContent>
        </Card>
      </SettingsSection>

      <Separator />

      <SettingsSection title="全局 AI 设置" description="配置 AI 服务的默认行为参数">
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
                  setSaveSuccess(null);
                  try {
                    await saveDraftToServer();
                    setSaveSuccess("全局 AI 设置已保存");
                  } catch (err) {
                    const message = err instanceof Error ? err.message : "保存失败";
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
                  if (confirm("确定要重置所有 AI 设置为默认值吗？")) {
                    resetToDefaults();
                    setSaveSuccess("已重置为默认值，请点击保存更改写回后端");
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

export function ApiKeyVisibilityToggle({
  isVisible,
  controlId,
  onToggle,
}: {
  isVisible: boolean;
  controlId: string;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={onToggle}
      aria-label={isVisible ? "隐藏 API Key" : "显示 API Key"}
      aria-controls={controlId}
      aria-pressed={isVisible}
      title={isVisible ? "隐藏 API Key" : "显示 API Key"}
    >
      {isVisible ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}

export function ProviderCard({
  provider,
  isEditing,
  isTesting,
  testResult,
  formData,
  onEdit,
  onCancel,
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
  onCancel: () => void;
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
  const apiKeyInputId = `provider-api-key-${provider.id}`;
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const providerSummary =
    provider.models.length > 0
      ? `${provider.provider} · ${provider.models[0]}`
      : provider.provider;

  useEffect(() => {
    if (!isEditing) {
      setIsApiKeyVisible(false);
    }
  }, [isEditing, provider.id]);

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all",
        provider.isActive ? "border-primary bg-primary/5 shadow-sm" : "hover:border-border/80"
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className={cn(
              "rounded-md p-2",
              provider.isActive ? "bg-primary text-primary-foreground" : "bg-muted"
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span className="truncate" title={provider.name}>
                {provider.name}
              </span>
              {provider.isActive && (
                <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded">
                  当前使用
                </span>
              )}
            </p>
            <p className="truncate text-xs capitalize text-muted-foreground" title={providerSummary}>
              {providerSummary}
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
              <div className="flex items-center gap-2">
                <Input
                  id={apiKeyInputId}
                  type={isApiKeyVisible ? "text" : "password"}
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
                <ApiKeyVisibilityToggle
                  isVisible={isApiKeyVisible}
                  controlId={apiKeyInputId}
                  onToggle={() => setIsApiKeyVisible((current) => !current)}
                />
              </div>
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
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
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
                className={cn(
                  "flex items-center gap-1 text-xs",
                  testResult.success ? "text-green-600" : "text-red-600"
                )}
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
