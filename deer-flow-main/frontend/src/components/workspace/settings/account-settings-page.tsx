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

type ProductEntitlementPayload = {
  product?: {
    product_display_name?: string;
    plan_key?: string;
    status?: string;
    expires_at?: string | null;
    sync_error?: string | null;
    entitlements?: {
      backend_storage_quota_bytes?: number;
      max_projects?: number;
      monthly_agent_runs?: number;
      max_concurrent_runs?: number;
      priority_queue?: boolean;
      features?: string[];
    };
  };
  usage?: {
    backend_storage?: {
      used_bytes?: number;
      quota_bytes?: number;
    };
    projects?: {
      used?: number;
      limit?: number;
    };
    agent_runs?: {
      used_runs?: number;
      limit?: number;
      period_end?: string;
    };
    max_concurrent_runs?: number;
  };
  upgrade_url?: string;
};

function formatPlanName(planKey: string | null | undefined): string {
  switch ((planKey ?? "free").toLowerCase()) {
    case "creator":
      return "Creator 创作者版";
    case "pro":
      return "Pro 高频作者版";
    case "studio":
      return "Studio 团队版";
    default:
      return "Free 免费试用";
  }
}

function formatBoolean(value: boolean | null | undefined): string {
  return value ? "已开启" : "未开启";
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
  const [productEntitlement, setProductEntitlement] =
    useState<ProductEntitlementPayload | null>(null);
  const newApiAccount = user?.newapi_account ?? null;
  const shouldWarnNewApiQuota =
    !!newApiAccount &&
    ((newApiAccount.remain_quota ?? Number.POSITIVE_INFINITY) <= 0 ||
      (newApiAccount.balance ?? Number.POSITIVE_INFINITY) <= 0);

  useEffect(() => {
    let cancelled = false;
    async function loadProductEntitlement() {
      try {
        const res = await fetch("/api/account/product-entitlement");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setProductEntitlement(data);
      } catch {
        // Product entitlement display is non-blocking.
      }
    }
    void loadProductEntitlement();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshProductEntitlement = async () => {
    const res = await fetch("/api/account/product-entitlement/refresh", {
      method: "POST",
      headers: getCsrfHeaders(),
    });
    if (res.ok) {
      setProductEntitlement(await res.json());
    }
  };

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
        title="Miaowu 会员权益"
        description="Miaowu 会员用于小说创作工作台能力；外部 AI 调用额度仍由 NewAPI 独立管理。"
      >
        <div className="max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {formatPlanName(productEntitlement?.product?.plan_key)}
            </Badge>
            <span className="text-muted-foreground text-sm">
              {productEntitlement?.product?.expires_at
                ? `到期：${formatSyncTime(productEntitlement.product.expires_at)}`
                : "长期有效或免费试用"}
            </span>
          </div>
          {productEntitlement?.product?.sync_error && (
            <Alert>
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>权益同步暂不可用</AlertTitle>
              <AlertDescription>
                当前按本地缓存或 Free 权益显示。可稍后刷新，已有项目数据不会被删除。
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground text-xs">服务端项目空间</div>
              <div className="mt-1 text-sm font-medium">
                {formatBytes(productEntitlement?.usage?.backend_storage?.used_bytes)} /{" "}
                {formatBytes(
                  productEntitlement?.usage?.backend_storage?.quota_bytes ??
                    productEntitlement?.product?.entitlements?.backend_storage_quota_bytes,
                )}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground text-xs">项目数量</div>
              <div className="mt-1 text-sm font-medium">
                {productEntitlement?.usage?.projects?.used ?? 0} /{" "}
                {productEntitlement?.usage?.projects?.limit ??
                  productEntitlement?.product?.entitlements?.max_projects ??
                  "—"}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground text-xs">本月 Agent run</div>
              <div className="mt-1 text-sm font-medium">
                {productEntitlement?.usage?.agent_runs?.used_runs ?? 0} /{" "}
                {productEntitlement?.usage?.agent_runs?.limit ??
                  productEntitlement?.product?.entitlements?.monthly_agent_runs ??
                  "—"}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground text-xs">并发任务</div>
              <div className="mt-1 text-sm font-medium">
                {productEntitlement?.usage?.max_concurrent_runs ??
                  productEntitlement?.product?.entitlements?.max_concurrent_runs ??
                  "—"}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground text-xs">优先队列</div>
              <div className="mt-1 text-sm font-medium">
                {formatBoolean(productEntitlement?.product?.entitlements?.priority_queue)}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground text-xs">高级功能</div>
              <div className="mt-1 truncate text-sm font-medium">
                {(productEntitlement?.product?.entitlements?.features ?? []).length} 项
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={refreshProductEntitlement}>
              刷新权益
            </Button>
            {productEntitlement?.upgrade_url ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => window.open(productEntitlement.upgrade_url, "_blank", "noopener,noreferrer")}
              >
                升级套餐
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="本地数据管理"
        description="本地缓存用于提升加载速度和离线草稿体验，可随时清理，不影响云端项目数据。"
      >
        <div className="max-w-xl space-y-3">
          <div className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">本地缓存保护</div>
            <div className="mt-1 text-sm font-medium">
              本地缓存已接近保护上限时，请清理本地缓存后继续。
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                browserStorageQuotaService.clearAppControlledStorage();
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
