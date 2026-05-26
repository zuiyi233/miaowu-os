import { useCallback, useEffect, useState } from "react";

import type { AiProviderConfig } from "@/core/ai/ai-provider-store";

import { fetchModelsFromProviderApi } from "../utils/model-capabilities";
import { isNewApiManagedProvider, shouldValidateFetchModelsCredentials } from "../utils/newapi-helpers";

export function useProviderManager(
  storeActions: {
    addProvider: (provider: AiProviderConfig) => void;
    updateProvider: (id: string, data: Partial<AiProviderConfig>) => void;
    deleteProvider: (id: string) => void;
    setActiveProvider: (id: string) => void;
    saveDraftToServer: () => Promise<void>;
  },
) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<AiProviderConfig>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  const saveProvider = useCallback(async () => {
    if (!editingId) return;
    storeActions.updateProvider(editingId, formData);
    setSaving(true);
    setSaveError(null);
    try {
      await storeActions.saveDraftToServer();
      setEditingId(null);
      setFormData({});
      setSaveSuccess("保存成功");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [editingId, formData, storeActions]);

  const addProvider = useCallback(() => {
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
    storeActions.addProvider(newProvider);
    setEditingId(id);
    setFormData(newProvider);
  }, [storeActions]);

  const deleteProvider = useCallback(
    async (id: string) => {
      storeActions.deleteProvider(id);
      if (editingId === id) {
        setEditingId(null);
        setFormData({});
      }
      setDeleteConfirmId(null);
      setSaving(true);
      try {
        await storeActions.saveDraftToServer();
        setSaveSuccess("删除成功");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "删除失败");
      } finally {
        setSaving(false);
      }
    },
    [storeActions, editingId],
  );

  const setActive = useCallback(
    async (id: string) => {
      storeActions.setActiveProvider(id);
      setSaving(true);
      try {
        await storeActions.saveDraftToServer();
        setSaveSuccess("已切换默认服务商");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "切换失败");
      } finally {
        setSaving(false);
      }
    },
    [storeActions],
  );

  const fetchModels = useCallback(async () => {
    const isManagedNewApi = isNewApiManagedProvider(formData);
    if (
      !isManagedNewApi &&
      shouldValidateFetchModelsCredentials(formData.provider) &&
      !formData.baseUrl &&
      !formData.apiKey
    ) {
      setFetchModelsError("请先填写接口地址和 API Key");
      return;
    }
    setFetchingModels(true);
    setFetchModelsError(null);
    try {
      const { models, modelGroups } = await fetchModelsFromProviderApi(
        formData.baseUrl ?? "",
        formData.apiKey ?? "",
        isManagedNewApi ? "newapi" : formData.provider ?? "openai",
        formData.id,
      );
      if (models.length === 0) {
        setFetchModelsError("未获取到任何模型，请检查接口地址和 API Key");
        return;
      }
      const fetched = [...models].sort();
      setFormData((prev) => ({ ...prev, models: fetched, modelGroups }));
    } catch (err) {
      setFetchModelsError(err instanceof Error ? err.message : "获取模型列表失败");
    } finally {
      setFetchingModels(false);
    }
  }, [formData]);

  return {
    editingId,
    formData,
    saving,
    saveError,
    saveSuccess,
    deleteConfirmId,
    fetchingModels,
    fetchModelsError,
    saveProvider,
    addProvider,
    deleteProvider,
    setActive,
    fetchModels,
    startEdit: (provider: AiProviderConfig) => {
      setEditingId(provider.id);
      setFormData({ ...provider, apiKey: "", clearApiKey: false });
      setFetchModelsError(null);
    },
    cancelEdit: () => {
      setEditingId(null);
      setFormData({});
      setFetchModelsError(null);
    },
    updateFormData: (data: Partial<AiProviderConfig>) => setFormData(data),
    setDeleteConfirmId,
    setSaveError,
    setSaveSuccess,
  };
}
