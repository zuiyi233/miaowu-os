"use client";

import { RefreshCcwIcon, SaveIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetch, resolveApiUrl } from "@/core/api/fetcher";

import { SettingsSection } from "./settings-section";

interface SystemSettings {
  backend_storage_quota_bytes: number;
  browser_storage_quota_bytes: number;
  backend_storage_quota_enabled: boolean;
  browser_storage_quota_enabled: boolean;
  updated_at?: string | null;
}

interface AdminUserRow {
  id: string;
  email: string;
  system_role: "admin" | "user";
  backend_used_bytes: number;
  backend_quota_bytes: number;
  backend_quota_source: string;
  browser_reported_used_bytes: number;
  browser_quota_bytes: number;
  browser_quota_source: string;
  product_entitlement?: {
    plan_key?: string;
    status?: string;
    synced_at?: string | null;
    sync_error?: string | null;
  };
}

interface StorageOverview {
  total_backend_used_bytes: number;
  active_object_count: number;
  deleted_object_count: number;
  over_quota_users: AdminUserRow[];
  orphan_object_count: number;
}

interface AuditLogRow {
  id: number;
  admin_user_id: string;
  target_user_id?: string | null;
  action: string;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  created_at?: string | null;
}

function formatBytes(value: number | null | undefined): string {
  const bytes = Number(value ?? 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = bytes / 1024;
  for (const unit of units) {
    if (current < 1024) return `${current.toFixed(1)} ${unit}`;
    current /= 1024;
  }
  return `${current.toFixed(1)} PB`;
}

function parseBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function formatPlanName(planKey: string | null | undefined): string {
  switch ((planKey ?? "free").toLowerCase()) {
    case "creator":
      return "Creator";
    case "pro":
      return "Pro";
    case "studio":
      return "Studio";
    default:
      return "Free";
  }
}

export function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [recalculateTask, setRecalculateTask] = useState<{ task_id: string; status: string } | null>(null);
  const [quotaDrafts, setQuotaDrafts] = useState<Record<string, { backend: string; browser: string }>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [settingsRes, usersRes, overviewRes, auditRes] = await Promise.all([
        fetch(resolveApiUrl("/api/admin/system-settings")),
        fetch(resolveApiUrl("/api/admin/users")),
        fetch(resolveApiUrl("/api/admin/storage/overview")),
        fetch(resolveApiUrl("/api/admin/audit-logs?limit=50")),
      ]);
      if (!settingsRes.ok || !usersRes.ok || !overviewRes.ok || !auditRes.ok) {
        throw new Error("load_failed");
      }
      setSettings(await settingsRes.json());
      const loadedUsers = (await usersRes.json()).users ?? [];
      setUsers(loadedUsers);
      setQuotaDrafts(
        Object.fromEntries(
          loadedUsers.map((user: AdminUserRow) => [
            user.id,
            {
              backend: String(user.backend_quota_bytes),
              browser: String(user.browser_quota_bytes),
            },
          ]),
        ),
      );
      setOverview(await overviewRes.json());
      setAuditLogs((await auditRes.json()).logs ?? []);
    } catch {
      setError("管理员数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSettings = async () => {
    if (!settings) return;
    setMessage("");
    setError("");
    try {
      const res = await fetch(resolveApiUrl("/api/admin/system-settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("save_failed");
      setSettings(await res.json());
      setMessage("系统设置已保存");
    } catch {
      setError("系统设置保存失败");
    }
  };

  const recalculateUser = async (userId: string) => {
    setMessage("");
    setError("");
    try {
      const res = await fetch(
        resolveApiUrl(`/api/admin/users/${userId}/recalculate-storage`),
        { method: "POST" },
      );
      if (!res.ok) throw new Error("recalculate_failed");
      setMessage("用户空间已重算");
      await load();
    } catch {
      setError("用户空间重算失败");
    }
  };

  const recalculateAll = async () => {
    setMessage("");
    setError("");
    try {
      const res = await fetch(resolveApiUrl("/api/admin/storage/recalculate-all"), {
        method: "POST",
      });
      if (!res.ok) throw new Error("recalculate_all_failed");
      const task = await res.json();
      setRecalculateTask(task);
      setMessage("全量重算任务已开始");
    } catch {
      setError("全量重算启动失败");
    }
  };

  useEffect(() => {
    if (!recalculateTask?.task_id || ["completed", "error"].includes(recalculateTask.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(resolveApiUrl(`/api/admin/storage/recalculate-all/${recalculateTask.task_id}`));
        if (!res.ok) return;
        const next = await res.json();
        setRecalculateTask(next);
        if (["completed", "error"].includes(next.status)) {
          window.clearInterval(timer);
          await load();
        }
      } catch {
        // Keep polling best-effort; admin can refresh manually.
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [recalculateTask?.task_id, recalculateTask?.status]);

  const saveUserQuota = async (userId: string) => {
    const draft = quotaDrafts[userId];
    if (!draft) return;
    setMessage("");
    setError("");
    try {
      const res = await fetch(resolveApiUrl(`/api/admin/users/${userId}/quota`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend_quota_bytes: parseBytes(draft.backend),
          browser_quota_bytes: parseBytes(draft.browser),
        }),
      });
      if (!res.ok) throw new Error("quota_failed");
      setMessage("用户配额已保存");
      await load();
    } catch {
      setError("用户配额保存失败");
    }
  };

  const refreshUserEntitlement = async (userId: string) => {
    setMessage("");
    setError("");
    try {
      const res = await fetch(resolveApiUrl(`/api/admin/users/${userId}/product-entitlement/refresh`), {
        method: "POST",
      });
      if (!res.ok) throw new Error("entitlement_refresh_failed");
      setMessage("用户权益已刷新");
      await load();
    } catch {
      setError("用户权益刷新失败");
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="系统空间设置"
        description="服务端空间用于项目后端存储，浏览器空间用于本机缓存限制。"
      >
        {settings && (
          <div className="max-w-2xl space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">后端默认空间 bytes</span>
                <Input
                  inputMode="numeric"
                  value={settings.backend_storage_quota_bytes}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      backend_storage_quota_bytes: parseBytes(event.target.value),
                    })
                  }
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-muted-foreground">浏览器默认空间 bytes</span>
                <Input
                  inputMode="numeric"
                  value={settings.browser_storage_quota_bytes}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      browser_storage_quota_bytes: parseBytes(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.backend_storage_quota_enabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      backend_storage_quota_enabled: event.target.checked,
                    })
                  }
                />
                启用后端空间限制
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.browser_storage_quota_enabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      browser_storage_quota_enabled: event.target.checked,
                    })
                  }
                />
                启用浏览器缓存限制
              </label>
            </div>
            <Button onClick={saveSettings} size="sm" className="gap-2">
              <SaveIcon className="size-4" />
              保存
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="存储概览">
        <div className="mb-3 flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2" onClick={recalculateAll}>
            <RefreshCcwIcon className="size-4" />
            全量重算
          </Button>
          {recalculateTask && (
            <span className="text-muted-foreground text-sm">
              任务 {recalculateTask.task_id.slice(0, 8)}: {recalculateTask.status}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">后端总占用</div>
            <div className="mt-1 text-sm font-medium">
              {formatBytes(overview?.total_backend_used_bytes)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">活跃对象</div>
            <div className="mt-1 text-sm font-medium">
              {overview?.active_object_count ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">已删对象</div>
            <div className="mt-1 text-sm font-medium">
              {overview?.deleted_object_count ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">超限用户</div>
            <div className="mt-1 text-sm font-medium">
              {overview?.over_quota_users?.length ?? 0}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="审计日志">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">时间</th>
                <th className="p-3 font-medium">管理员</th>
                <th className="p-3 font-medium">目标用户</th>
                <th className="p-3 font-medium">动作</th>
                <th className="p-3 font-medium">字段</th>
                <th className="p-3 font-medium">旧值</th>
                <th className="p-3 font-medium">新值</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="p-3">{log.created_at ? new Date(log.created_at).toLocaleString() : "-"}</td>
                  <td className="p-3">{log.admin_user_id}</td>
                  <td className="p-3">{log.target_user_id || "-"}</td>
                  <td className="p-3">{log.action}</td>
                  <td className="p-3">{log.field || "-"}</td>
                  <td className="p-3">{log.old_value ?? "-"}</td>
                  <td className="p-3">{log.new_value ?? "-"}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td className="text-muted-foreground p-3" colSpan={7}>
                    暂无审计日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <SettingsSection title="用户空间">
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">用户</th>
                <th className="p-3 font-medium">角色</th>
                <th className="p-3 font-medium">套餐</th>
                <th className="p-3 font-medium">权益同步</th>
                <th className="p-3 font-medium">后端占用</th>
                <th className="p-3 font-medium">后端额度 bytes</th>
                <th className="p-3 font-medium">浏览器上报</th>
                <th className="p-3 font-medium">浏览器额度 bytes</th>
                <th className="p-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="p-3">{user.email}</td>
                  <td className="p-3">{user.system_role}</td>
                  <td className="p-3">
                    {formatPlanName(user.product_entitlement?.plan_key)}
                  </td>
                  <td className="p-3">
                    <div className="space-y-1">
                      <div>{user.product_entitlement?.status ?? "fallback"}</div>
                      {user.product_entitlement?.sync_error ? (
                        <div className="max-w-40 truncate text-xs text-red-600">
                          {user.product_entitlement.sync_error}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-xs">
                          {user.product_entitlement?.synced_at
                            ? new Date(user.product_entitlement.synced_at).toLocaleString()
                            : "未同步"}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-3">{formatBytes(user.backend_used_bytes)}</td>
                  <td className="p-3">
                    <Input
                      className="h-8 w-32"
                      inputMode="numeric"
                      value={quotaDrafts[user.id]?.backend ?? String(user.backend_quota_bytes)}
                      onChange={(event) =>
                        setQuotaDrafts((prev) => ({
                          ...prev,
                          [user.id]: {
                            backend: event.target.value,
                            browser: prev[user.id]?.browser ?? String(user.browser_quota_bytes),
                          },
                        }))
                      }
                    />
                  </td>
                  <td className="p-3">
                    {formatBytes(user.browser_reported_used_bytes)}
                  </td>
                  <td className="p-3">
                    <Input
                      className="h-8 w-32"
                      inputMode="numeric"
                      value={quotaDrafts[user.id]?.browser ?? String(user.browser_quota_bytes)}
                      onChange={(event) =>
                        setQuotaDrafts((prev) => ({
                          ...prev,
                          [user.id]: {
                            backend: prev[user.id]?.backend ?? String(user.backend_quota_bytes),
                            browser: event.target.value,
                          },
                        }))
                      }
                    />
                  </td>
                  <td className="flex gap-2 p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => saveUserQuota(user.id)}
                    >
                      <SaveIcon className="size-4" />
                      保存
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => recalculateUser(user.id)}
                    >
                      <RefreshCcwIcon className="size-4" />
                      重算
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => refreshUserEntitlement(user.id)}
                    >
                      <RefreshCcwIcon className="size-4" />
                      权益
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      {loading && <p className="text-muted-foreground text-sm">加载中...</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
