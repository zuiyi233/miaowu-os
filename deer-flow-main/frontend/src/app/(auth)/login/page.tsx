"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { resolveApiUrl } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";

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

function resolveNewApiPortalUrl(): string {
  const configured = process.env.NEXT_PUBLIC_NEWAPI_PORTAL_URL?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:3000";
  }

  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:3000";
  }

  return "https://xg.miaowu.bond";
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, refreshUser } = useAuth();
  const [portalOpened, setPortalOpened] = useState(false);
  const [authorizationOpened, setAuthorizationOpened] = useState(false);
  const [authorizationStartedAt, setAuthorizationStartedAt] = useState<
    number | null
  >(null);

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
    if (isAuthenticated || !authorizationStartedAt) return;

    const maxPollingUntil = authorizationStartedAt + 2 * 60_000;
    const interval = window.setInterval(() => {
      if (Date.now() > maxPollingUntil) {
        window.clearInterval(interval);
        return;
      }
      void refreshUser();
    }, 3_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [authorizationStartedAt, isAuthenticated, refreshUser]);

  const handleOpenNewApiLogin = () => {
    setPortalOpened(true);
    window.open(resolveNewApiPortalUrl(), "_blank", "noopener,noreferrer");
  };

  const handleContinueAuthorization = () => {
    setAuthorizationOpened(true);
    setAuthorizationStartedAt(Date.now());
    window.open(newApiLoginUrl, "_blank", "noopener,noreferrer");
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
          disabled={!portalOpened}
          variant={portalOpened ? "default" : "secondary"}
          onClick={handleContinueAuthorization}
        >
          已确认账号，继续授权登录
        </Button>
        {authorizationOpened && (
          <p className="text-muted-foreground text-xs">
            授权完成后保持本页打开，Miaowu 会自动进入工作区。
          </p>
        )}
      </div>
    </main>
  );
}
