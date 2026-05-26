import { useCallback, useEffect, useState } from "react";

import {
  fetchNewApiSyncGroups,
  syncNewApiGroups,
  type NewApiSyncGroupItem,
  type NewApiSyncGroupResult,
} from "@/core/ai/useAiSettingsApi";

import { buildNewApiResyncUrl, normalizeManualGroups } from "../utils/newapi-helpers";

const NEWAPI_SYNC_PENDING_KEY = "miaowu.newapi-sync.pending";

export function useNewApiSync(
  refreshFromServer: () => Promise<void>,
  notifications: {
    clearMessages: () => void;
    onError: (error: string) => void;
    onSuccess: (message: string) => void;
  },
) {
  const [syncPending, setSyncPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [groups, setGroups] = useState<NewApiSyncGroupItem[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [manualGroups, setManualGroups] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [results, setResults] = useState<NewApiSyncGroupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pending = window.localStorage.getItem(NEWAPI_SYNC_PENDING_KEY) === "1";
    setSyncPending(pending);
  }, []);

  useEffect(() => {
    if (!syncPending || typeof window === "undefined") return;

    const refreshAfterSync = () => {
      if (document.visibilityState === "hidden") return;
      refreshFromServer()
        .then(() => {
          window.localStorage.removeItem(NEWAPI_SYNC_PENDING_KEY);
          setSyncPending(false);
          notifications.onSuccess("已重新拉取 NewAPI 分组和模型配置。");
        })
        .catch((err) => {
          notifications.onError(err instanceof Error ? err.message : "NewAPI 同步后刷新失败");
        });
    };

    window.addEventListener("focus", refreshAfterSync);
    document.addEventListener("visibilitychange", refreshAfterSync);
    const timer = window.setTimeout(refreshAfterSync, 1500);

    return () => {
      window.removeEventListener("focus", refreshAfterSync);
      document.removeEventListener("visibilitychange", refreshAfterSync);
      window.clearTimeout(timer);
    };
  }, [syncPending, refreshFromServer, notifications]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const data = await fetchNewApiSyncGroups();
      setGroups(data.groups ?? []);
      setWarnings(data.warnings ?? []);
      setSelectedGroups((prev) => {
        const availableIds = new Set((data.groups ?? []).map((group) => group.group_id));
        const kept = new Set([...prev].filter((groupId) => availableIds.has(groupId)));
        if (kept.size === 0 && data.groups.length === 1) {
          kept.add(data.groups[0]!.group_id);
        }
        return kept;
      });
    } catch (err) {
      setGroups([]);
      setWarnings([]);
      setError(err instanceof Error ? err.message : "NewAPI 分组读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const openDialog = useCallback(() => {
    setDialogOpen(true);
    void loadGroups();
  }, [loadGroups]);

  const openLoginTab = useCallback(() => {
    window.localStorage.setItem(NEWAPI_SYNC_PENDING_KEY, "1");
    setSyncPending(true);
    notifications.clearMessages();
    notifications.onSuccess("已打开 NewAPI 同步窗口；完成登录后回到本页会自动刷新。");
    window.open(buildNewApiResyncUrl(), "_blank", "noopener,noreferrer");
  }, [notifications]);

  const applySync = useCallback(async () => {
    const selected = [...selectedGroups];
    const manual = normalizeManualGroups(manualGroups);
    if (selected.length === 0 && manual.length === 0) {
      setError("请选择分组，或手动输入至少一个分组名");
      return;
    }
    setApplying(true);
    setError(null);
    setResults([]);
    try {
      const result = await syncNewApiGroups({ groups: selected, manual_groups: manual });
      setResults(result.results ?? []);
      await refreshFromServer();
      notifications.onSuccess("NewAPI 分组同步完成，已刷新服务商列表。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "NewAPI 分组同步失败");
    } finally {
      setApplying(false);
    }
  }, [manualGroups, selectedGroups, refreshFromServer, notifications]);

  return {
    syncPending,
    dialogOpen,
    groups,
    selectedGroups,
    manualGroups,
    warnings,
    results,
    loading,
    applying,
    error,
    openDialog,
    closeDialog: () => setDialogOpen(false),
    setDialogOpen,
    openLoginTab,
    applySync,
    reloadGroups: loadGroups,
    setSelectedGroups,
    setManualGroups,
  };
}
