"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Plus,
  RefreshCw,
  Save,
  Shield,
} from "lucide-react";
import { useCallback, useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Separator } from "@/components/ui/separator";
import {
  useAiProviderStore,
} from "@/core/ai/ai-provider-store";
import type { AiModelTarget } from "@/core/ai/feature-routing";
import {
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
} from "@/core/ai/feature-routing";
import { cn } from "@/lib/utils";

import { FeatureModuleList } from "./components/feature-module-list";
import { GlobalRoutingPanel } from "./components/global-routing-panel";
import { NewApiSyncDialog } from "./components/new-api-sync-dialog";
import { ProviderCard } from "./components/provider-card";
export { ProviderCard } from "./components/provider-card";
import { useFeatureRouting } from "./hooks/use-feature-routing";
import { useNewApiSync } from "./hooks/use-new-api-sync";
import { useProviderManager } from "./hooks/use-provider-manager";
import { SettingsSection } from "./settings-section";
export { shouldValidateFetchModelsCredentials } from "./utils/newapi-helpers";
import {
  isNewApiManagedProvider,
} from "./utils/newapi-helpers";

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

  const providers = draft.providers;

  const providerMgr = useProviderManager({
    addProvider,
    updateProvider,
    deleteProvider,
    setActiveProvider,
    saveDraftToServer,
  });

  const newApiSync = useNewApiSync(refreshFromServer, {
    clearMessages: () => { providerMgr.setSaveError(null); providerMgr.setSaveSuccess(null); },
    onError: (msg) => providerMgr.setSaveError(msg),
    onSuccess: (msg) => providerMgr.setSaveSuccess(msg),
  });

  const routing = useFeatureRouting(providers, {
    hydrated,
    featureRoutingSettings: draft.featureRoutingSettings,
    defaultProviderId: draft.defaultProviderId,
    saveFeatureRoutingToServer,
  });

  useEffect(() => {
    ensureHydrated().catch(() => undefined);
  }, [ensureHydrated]);

  const normalizedDefaultProviderId =
    typeof draft.defaultProviderId === "string"
      ? draft.defaultProviderId.trim()
      : "";
  const hasActiveProvider =
    providers.some((provider) => provider.isActive) ||
    (normalizedDefaultProviderId.length > 0 &&
      providers.some((provider) => provider.id === normalizedDefaultProviderId));

  const managedNewApiProviders = providers.filter((provider) => isNewApiManagedProvider(provider));

  const handleRefreshProviders = useCallback(() => {
    providerMgr.setSaveError(null);
    providerMgr.setSaveSuccess(null);
    refreshFromServer().catch((err) => providerMgr.setSaveError(err instanceof Error ? err.message : "刷新失败"));
  }, [providerMgr, refreshFromServer]);

  const handleResetRoutingDraft = useCallback(() => {
    const backendOrDefault = draft.featureRoutingSettings ?? loadFeatureRoutingState(draft.providers);
    routing.setRoutingDraft(normalizeFeatureRoutingState(backendOrDefault, draft.providers));
    routing.setRoutingDirty(false);
    routing.setRoutingNotice(null);
  }, [draft.featureRoutingSettings, draft.providers, routing]);

  const handleGlobalBackupChange = useCallback((target: AiModelTarget | null) => {
    routing.setGlobalBackup(target);
    routing.setGlobalPending(true);
    if (!target) routing.setGlobalAutoFailover(false);
  }, [routing]);

  const handleGlobalAutoFailoverChange = useCallback((value: boolean) => {
    routing.setGlobalAutoFailover(value);
    routing.setGlobalPending(true);
  }, [routing]);

  const handleGlobalParallelEnabledChange = useCallback((value: boolean) => {
    routing.setGlobalParallelEnabled(value);
    routing.setGlobalPending(true);
  }, [routing]);

  const handleDefaultTargetChange = useCallback((target: AiModelTarget | null) => {
    routing.mutateRouting((state) => ({
      ...state,
      defaultTarget: target,
    }));
  }, [routing]);

  return (
    <div className="space-y-8">
      {hydrationError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{hydrationError}</AlertDescription>
        </Alert>
      )}

      {providerMgr.saveError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{providerMgr.saveError}</AlertDescription>
        </Alert>
      )}

      {providerMgr.saveSuccess && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>操作成功</AlertTitle>
          <AlertDescription>{providerMgr.saveSuccess}</AlertDescription>
        </Alert>
      )}

      <NewApiSyncDialog
        open={newApiSync.dialogOpen}
        onClose={newApiSync.closeDialog}
        onOpenChange={newApiSync.setDialogOpen}
        groups={newApiSync.groups}
        selectedGroups={newApiSync.selectedGroups}
        manualGroups={newApiSync.manualGroups}
        warnings={newApiSync.warnings}
        results={newApiSync.results}
        loading={newApiSync.loading}
        applying={newApiSync.applying}
        error={newApiSync.error}
        onSelectedGroupsChange={newApiSync.setSelectedGroups}
        onManualGroupsChange={newApiSync.setManualGroups}
        onApply={newApiSync.applySync}
        onReloadGroups={newApiSync.reloadGroups}
        onOpenLoginTab={newApiSync.openLoginTab}
      />

      <SettingsSection title="AI 服务商" description="NewAPI 是系统内置统一供应商；也可以按需添加 OpenAI、Anthropic、Google 或自定义第三方供应商。">
        <div className="flex items-center gap-2 mb-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshProviders}
            disabled={hydrating || providerMgr.saving}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", hydrating && "animate-spin")} />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={resetDraftToEffective} disabled={providerMgr.saving || !hydrated}>
            撤销修改
          </Button>
          <Button variant="default" size="sm" onClick={providerMgr.addProvider} disabled={Boolean(hydrationError) || providerMgr.saving}>
            <Plus className="h-4 w-4 mr-1" />
            添加服务商
          </Button>
          <Button variant="outline" size="sm" onClick={newApiSync.openDialog} disabled={providerMgr.saving}>
            <ExternalLink className="h-4 w-4 mr-1" />
            {newApiSync.syncPending ? "等待 NewAPI 同步" : "同步 NewAPI 分组/密钥"}
          </Button>
        </div>

        <Alert className="mb-3">
          <CircleHelp className="h-4 w-4" />
          <AlertTitle>供应商来源说明</AlertTitle>
          <AlertDescription>
            NewAPI 由后端统一管理模型、分组和密钥；第三方供应商配置保存到后端数据库，不会直接改写
            <code className="mx-1">config.yaml</code>
            或
            <code className="mx-1">.env</code> 文件。
            {managedNewApiProviders.length > 0 ? ` 当前已同步 ${managedNewApiProviders.length} 个 NewAPI 分组。` : ""}
          </AlertDescription>
        </Alert>

        {providerMgr.editingId && (
          <Alert className="mb-3 border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle>你有未保存的服务商编辑</AlertTitle>
            <AlertDescription>
              当前输入仅在本地草稿中，需点击对应卡片内的「保存」后才会写入后端并用于运行时请求。
            </AlertDescription>
          </Alert>
        )}

        {providers.length > 0 && !hasActiveProvider && (
          <Alert className="mb-3 border-destructive/40">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>未选择默认服务商</AlertTitle>
            <AlertDescription>
              请先点击任一服务商的「设为默认」并保存，否则运行时可能无法解析可用配置。
            </AlertDescription>
          </Alert>
        )}

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
                isEditing={providerMgr.editingId === provider.id}
                formData={providerMgr.formData}
                fetchingModels={providerMgr.fetchingModels}
                fetchModelsError={providerMgr.fetchModelsError}
                onEdit={() => providerMgr.startEdit(provider)}
                onCancel={providerMgr.cancelEdit}
                onSave={providerMgr.saveProvider}
                onDelete={() => providerMgr.setDeleteConfirmId(provider.id)}
                onSetActive={() => void providerMgr.setActive(provider.id)}
                onFormChange={providerMgr.updateFormData}
                onFetchModels={providerMgr.fetchModels}
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

        {routing.routingNotice && (
          <Alert variant={routing.routingNotice.type === "error" ? "destructive" : "default"} className="mb-4">
            {routing.routingNotice.type === "error" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            <AlertTitle>{routing.routingNotice.type === "error" ? "操作失败" : "操作成功"}</AlertTitle>
            <AlertDescription>{routing.routingNotice.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2 mb-6">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetRoutingDraft}
            disabled={!routing.routingDirty || routing.routingSaving}
          >
            撤销修改
          </Button>
          <Button size="sm" onClick={() => void routing.saveRouting()} disabled={!routing.routingDirty || routing.routingSaving}>
            {routing.routingSaving ? (
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

        <GlobalRoutingPanel
          providers={providers}
          defaultTarget={routing.defaultTarget}
          globalBackup={routing.globalBackup}
          globalAutoFailover={routing.globalAutoFailover}
          globalParallelEnabled={routing.globalParallelEnabled}
          globalPending={routing.globalPending}
          onDefaultTargetChange={handleDefaultTargetChange}
          onGlobalBackupChange={handleGlobalBackupChange}
          onGlobalAutoFailoverChange={handleGlobalAutoFailoverChange}
          onGlobalParallelEnabledChange={handleGlobalParallelEnabledChange}
          onApplyGlobal={routing.applyGlobal}
        />

        <FeatureModuleList
          routingDraft={routing.routingDraft}
          expandedModules={routing.expandedModules}
          providers={providers}
          isModuleUsingGlobal={routing.isModuleUsingGlobal}
          onToggleExpand={routing.toggleModuleExpand}
          createPrimaryChangeHandler={routing.createPrimaryChangeHandler}
          createBackupChangeHandler={routing.createBackupChangeHandler}
          patchModule={routing.patchModule}
          onRemoveModule={routing.removeCustomModule}
          deleteModuleConfirmId={routing.deleteModuleConfirmId}
          onDeleteModuleConfirm={routing.setDeleteModuleConfirmId}
        />

        <div className="mt-4 flex items-center gap-2">
          <Input
            value={routing.newModuleLabel}
            onChange={(e) => routing.setNewModuleLabel(e.target.value)}
            placeholder="自定义模块名称"
            className="max-w-xs"
          />
          <Button variant="outline" size="sm" onClick={routing.addCustomModule}>
            <Plus className="h-4 w-4 mr-1" />
            添加自定义模块
          </Button>
        </div>
      </SettingsSection>

      <Dialog open={providerMgr.deleteConfirmId !== null} onOpenChange={(open) => { if (!open) providerMgr.setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除这个服务商吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => providerMgr.setDeleteConfirmId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (providerMgr.deleteConfirmId) void providerMgr.deleteProvider(providerMgr.deleteConfirmId);
              }}
              disabled={providerMgr.saving}
            >
              {providerMgr.saving ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
