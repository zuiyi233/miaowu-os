"use client";

import { AlertTriangleIcon, LogOutIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetch, getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { parseAuthError } from "@/core/auth/types";
import { useI18n } from "@/core/i18n/hooks";
import { browserStorageQuotaService } from "@/core/storage/browser-quota";

import { SettingsSection } from "./settings-section";

const NEWAPI_QUOTA_PER_USD = 500000;

function formatNewApiQuotaUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const usd = value / NEWAPI_QUOTA_PER_USD;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usd >= 100 ? 2 : 4,
  }).format(usd);
}

function formatSyncTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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

export function AccountSettingsPage() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [storageUsage, setStorageUsage] = useState<any>(null);
  const newApiAccount = user?.newapi_account ?? null;
  const shouldWarnNewApiQuota =
    !!newApiAccount &&
    ((newApiAccount.remain_quota ?? Number.POSITIVE_INFINITY) <= 0 ||
      (newApiAccount.balance ?? Number.POSITIVE_INFINITY) <= 0);

  useEffect(() => {
    let cancelled = false;
    async function loadStorageUsage() {
      try {
        await browserStorageQuotaService.reportUsage();
        const res = await fetch("/api/account/storage-usage");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStorageUsage(data);
      } catch {
        // Storage usage display is non-blocking.
      }
    }
    void loadStorageUsage();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError(t.settings.account.passwordMismatch);
      return;
    }
    if (newPassword.length < 8) {
      setError(t.settings.account.passwordTooShort);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeaders(),
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      setMessage(t.settings.account.passwordChangedSuccess);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError(t.settings.account.networkError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title={t.settings.account.profileTitle}>
        <div className="space-y-2">
          <div className="grid grid-cols-[max-content_max-content] items-center gap-4">
            <span className="text-muted-foreground text-sm">
              {t.settings.account.email}
            </span>
            <span className="text-sm font-medium">{user?.email ?? "—"}</span>
            <span className="text-muted-foreground text-sm">
              {t.settings.account.role}
            </span>
            <span className="text-sm font-medium capitalize">
              {user?.system_role ?? "—"}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="NewAPI 账号"
        description="当前登录身份和额度快照来自 NewAPI。"
      >
        {newApiAccount ? (
          <div className="max-w-xl space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">已绑定</Badge>
              <span className="text-muted-foreground text-sm">
                {newApiAccount.email ?? newApiAccount.username ?? newApiAccount.newapi_sub}
              </span>
            </div>
            {shouldWarnNewApiQuota && (
              <Alert>
                <AlertTriangleIcon className="size-4" />
                <AlertTitle>NewAPI 额度不足</AlertTitle>
                <AlertDescription>
                  当前 NewAPI 余额或剩余额度为 0。Miaowu 不会拦截本次登录，但 AI 功能可能会被上游拒绝。
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">余额</div>
                <div className="mt-1 text-sm font-medium">
                  {formatNewApiQuotaUsd(newApiAccount.balance)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">剩余额度</div>
                <div className="mt-1 text-sm font-medium">
                  {formatNewApiQuotaUsd(newApiAccount.remain_quota)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">已用额度</div>
                <div className="mt-1 text-sm font-medium">
                  {formatNewApiQuotaUsd(newApiAccount.used_quota)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">总额度</div>
                <div className="mt-1 text-sm font-medium">
                  {formatNewApiQuotaUsd(newApiAccount.quota)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-2">
              <span className="text-muted-foreground text-sm">NewAPI ID</span>
              <span className="truncate text-sm font-medium">
                {newApiAccount.newapi_sub}
              </span>
              <span className="text-muted-foreground text-sm">最近同步</span>
              <span className="text-sm font-medium">
                {formatSyncTime(newApiAccount.last_synced_at)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            当前没有绑定 NewAPI 账号。请从登录页使用 NewAPI 登录。
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Miaowu 本地空间"
        description="服务端空间和浏览器本地缓存是独立额度，不等同于 NewAPI 额度。"
      >
        <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">服务端空间</div>
            <div className="mt-1 text-sm font-medium">
              {formatBytes(storageUsage?.backend?.used_bytes)} /{" "}
              {formatBytes(storageUsage?.backend?.quota_bytes)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">浏览器本地缓存</div>
            <div className="mt-1 text-sm font-medium">
              {formatBytes(storageUsage?.browser?.reported_used_bytes)} /{" "}
              {formatBytes(storageUsage?.browser?.quota_bytes)}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                browserStorageQuotaService.clearAppControlledStorage();
                setStorageUsage(null);
              }}
            >
              清理本地缓存
            </Button>
          </div>
        </div>
      </SettingsSection>

      {newApiAccount ? (
        <SettingsSection
          title="密码管理"
          description="当前账号通过 NewAPI 登录，密码由 NewAPI 统一管理。"
        >
          <div className="max-w-xl rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
            请到 NewAPI 修改密码。Miaowu 不保存也不修改 NewAPI 密码。
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection
          title={t.settings.account.changePasswordTitle}
          description={t.settings.account.changePasswordDescription}
        >
          <form onSubmit={handleChangePassword} className="max-w-sm space-y-3">
            <Input
              type="password"
              placeholder={t.settings.account.currentPassword}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder={t.settings.account.newPassword}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
            <Input
              type="password"
              placeholder={t.settings.account.confirmNewPassword}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            {message && <p className="text-sm text-green-500">{message}</p>}
            <Button type="submit" variant="outline" size="sm" disabled={loading}>
              {loading
                ? t.settings.account.updating
                : t.settings.account.updatePassword}
            </Button>
          </form>
        </SettingsSection>
      )}

      <SettingsSection title="" description="">
        <Button
          variant="destructive"
          size="sm"
          onClick={logout}
          className="gap-2"
        >
          <LogOutIcon className="size-4" />
          {t.settings.account.signOut}
        </Button>
      </SettingsSection>
    </div>
  );
}
