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

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [redirectFailed, setRedirectFailed] = useState(false);

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
      return;
    }

    const timeout = window.setTimeout(() => {
      setRedirectFailed(true);
    }, 3000);

    window.location.replace(newApiLoginUrl);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isAuthenticated, newApiLoginUrl, redirectPath, router]);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl">Miaowu OS</h1>
          <p className="text-muted-foreground text-sm">
            正在前往 NewAPI 账号登录。
          </p>
        </div>

        {redirectFailed && (
          <p className="text-muted-foreground text-sm">
            如果浏览器没有自动跳转，请手动继续登录。
          </p>
        )}

        <Button asChild className="w-full">
          <a href={newApiLoginUrl}>使用 NewAPI 登录</a>
        </Button>
      </div>
    </main>
  );
}
