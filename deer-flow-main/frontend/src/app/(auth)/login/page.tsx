"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { resolveApiUrl } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";

const DEFAULT_NEWAPI_PORTAL_URL = "https://xg.miaowu.bond";

/**
 * Validate next parameter.
 * Prevent open redirect attacks by allowing only relative paths.
 */
function validateNextParam(next: string | null): string | null {
  if (!next) {
    return null;
  }

  if (!next.startsWith("/") || next.startsWith("//")) {
    return null;
  }

  if (next.includes(":") && !next.startsWith("/")) {
    return null;
  }

  return next;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [portalOpened, setPortalOpened] = useState(false);
  const [authorizationStarted, setAuthorizationStarted] = useState(false);
  const [newApiPortalUrl, setNewApiPortalUrl] = useState(
    DEFAULT_NEWAPI_PORTAL_URL,
  );

  const redirectPath =
    validateNextParam(searchParams.get("next")) ?? "/workspace";
  const newApiLoginUrl = useMemo(
    () =>
      resolveApiUrl(
        `/api/v1/auth/login/newapi?next=${encodeURIComponent(redirectPath)}`,
      ),
    [redirectPath],
  );

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(redirectPath);
    }
  }, [isAuthenticated, redirectPath, router]);

  useEffect(() => {
    let cancelled = false;

    globalThis
      .fetch("/runtime-config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { newapi_portal_url?: unknown } | null) => {
        const portalUrl =
          typeof data?.newapi_portal_url === "string"
            ? data.newapi_portal_url.trim()
            : "";
        if (!cancelled && portalUrl) {
          setNewApiPortalUrl(portalUrl);
        }
      })
      .catch(() => {
        // Keep the built-in public NewAPI fallback if runtime config is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenNewApiLogin = () => {
    setPortalOpened(true);
    window.open(newApiPortalUrl, "_blank", "noopener,noreferrer");
  };

  const handleContinueAuthorization = () => {
    setAuthorizationStarted(true);
    window.location.assign(newApiLoginUrl);
  };

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="space-y-2">
          <img
            src="/brand/miaowu-logo.webp"
            alt="Miaowu OS"
            className="mx-auto size-16 rounded-2xl object-cover"
          />
          <h1 className="font-serif text-3xl">Miaowu OS</h1>
          <p className="text-muted-foreground text-sm">
            请先在新标签页确认 NewAPI 账号，再返回本页继续授权。
          </p>
        </div>

        {portalOpened && (
          <p className="text-muted-foreground text-sm">
            如果 NewAPI 已经登录，也请先确认当前账号无误。
          </p>
        )}

        <Button className="w-full" onClick={handleOpenNewApiLogin}>
          打开 NewAPI 账号中心
        </Button>
        <Button
          className="w-full"
          disabled={!portalOpened || authorizationStarted}
          variant={portalOpened ? "default" : "secondary"}
          onClick={handleContinueAuthorization}
        >
          {authorizationStarted ? "正在进入授权..." : "已确认账号，继续授权登录"}
        </Button>
      </div>
    </main>
  );
}
