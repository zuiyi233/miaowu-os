import { useCallback, useEffect, useState } from "react";

import type { AiProviderConfig } from "@/core/ai/ai-provider-store";
import {
  createCustomModuleRoute,
  isFeatureModuleConfigurableInSettings,
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
  type AiFeatureModuleRoute,
  type AiFeatureRoutingState,
  type AiModelTarget,
  type AiParallelStrategy,
} from "@/core/ai/feature-routing";

export function useFeatureRouting(
  providers: AiProviderConfig[],
  storeData: {
    hydrated: boolean;
    featureRoutingSettings: AiFeatureRoutingState | null;
    saveFeatureRoutingToServer: (state: AiFeatureRoutingState | null) => Promise<AiFeatureRoutingState | null>;
  },
) {
  const [routingDraft, setRoutingDraft] = useState<AiFeatureRoutingState | null>(null);
  const [routingDirty, setRoutingDirty] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingNotice, setRoutingNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [newModuleLabel, setNewModuleLabel] = useState("");
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [deleteModuleConfirmId, setDeleteModuleConfirmId] = useState<string | null>(null);
  const [globalBackup, setGlobalBackup] = useState<AiModelTarget | null>(null);
  const [globalAutoFailover, setGlobalAutoFailover] = useState(true);
  const [globalParallelEnabled, setGlobalParallelEnabled] = useState(false);
  const [globalPending, setGlobalPending] = useState(false);

  const defaultTarget = routingDraft?.defaultTarget ?? null;

  useEffect(() => {
    if (routingNotice) {
      const timer = setTimeout(() => setRoutingNotice(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [routingNotice]);

  useEffect(() => {
    if (!storeData.hydrated) return;
    const backendOrDefault = storeData.featureRoutingSettings ?? loadFeatureRoutingState(providers);
    const normalized = normalizeFeatureRoutingState(backendOrDefault, providers);
    setRoutingDraft((prev) => {
      if (routingDirty && prev) return normalizeFeatureRoutingState(prev, providers);
      return normalized;
    });
  }, [storeData.hydrated, storeData.featureRoutingSettings, providers, routingDirty]);

  const mutateRouting = useCallback(
    (updater: (state: AiFeatureRoutingState) => AiFeatureRoutingState) => {
      setRoutingDraft((prev) => {
        if (!prev) return prev;
        return normalizeFeatureRoutingState(updater(prev), providers);
      });
      setRoutingDirty(true);
      setRoutingNotice(null);
    },
    [providers],
  );

  const patchModule = useCallback(
    (moduleId: string, patch: Partial<AiFeatureModuleRoute>) => {
      mutateRouting((state) => ({
        ...state,
        modules: state.modules.map((m) => (m.moduleId === moduleId ? { ...m, ...patch } : m)),
      }));
    },
    [mutateRouting],
  );

  const createPrimaryChangeHandler = useCallback(
    (moduleId: string, parallelTargets: AiFeatureModuleRoute["parallelTargets"]) =>
      (target: AiModelTarget | null) =>
        patchModule(moduleId, {
          primaryTarget: target,
          parallelTargets: parallelTargets.length > 0 ? parallelTargets : target ? [target] : [],
        }),
    [patchModule],
  );

  const createBackupChangeHandler = useCallback(
    (moduleId: string, currentMode: AiFeatureModuleRoute["currentMode"]) =>
      (target: AiModelTarget | null) =>
        patchModule(moduleId, {
          backupTarget: target,
          currentMode: !target && currentMode === "backup" ? "primary" : currentMode,
        }),
    [patchModule],
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
    [defaultTarget, globalBackup, globalParallelEnabled],
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

  const saveRouting = useCallback(async () => {
    if (!routingDraft) return;
    setRoutingSaving(true);
    setRoutingNotice(null);
    try {
      const normalized = normalizeFeatureRoutingState(routingDraft, providers);
      await storeData.saveFeatureRoutingToServer(normalized);
      setRoutingDirty(false);
      setRoutingNotice({ type: "success", message: "模型配置已保存" });
    } catch (err) {
      setRoutingNotice({ type: "error", message: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setRoutingSaving(false);
    }
  }, [providers, routingDraft, storeData]);

  const addCustomModule = useCallback(() => {
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

  const removeCustomModule = useCallback(
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
    [mutateRouting],
  );

  const toggleModuleExpand = useCallback((moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  return {
    routingDraft,
    routingDirty,
    routingSaving,
    routingNotice,
    newModuleLabel,
    expandedModules,
    deleteModuleConfirmId,
    globalBackup,
    globalAutoFailover,
    globalParallelEnabled,
    globalPending,
    defaultTarget,
    setNewModuleLabel,
    setDeleteModuleConfirmId,
    setGlobalBackup,
    setGlobalAutoFailover,
    setGlobalParallelEnabled,
    setGlobalPending,
    setRoutingDraft,
    setRoutingDirty,
    setRoutingNotice,
    mutateRouting,
    patchModule,
    saveRouting,
    addCustomModule,
    removeCustomModule,
    applyGlobal: handleApplyGlobal,
    createPrimaryChangeHandler,
    createBackupChangeHandler,
    isModuleUsingGlobal,
    toggleModuleExpand,
  };
}
