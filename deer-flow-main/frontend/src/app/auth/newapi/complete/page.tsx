"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { resolveApiUrl } from "@/core/api/fetcher";

function validateNextParam(next: string | null): string {
  if (!next) {
    return "/workspace";
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes(":")) {
    return "/workspace";
  }
  return next;
}

export default function NewApiOAuthCompletePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const nextPath = validateNextParam(searchParams.get("next"));

    const confirmSession = async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          const response = await fetch(resolveApiUrl("/api/v1/auth/me"), {
            cache: "no-store",
            credentials: "include",
          });
          if (response.ok) {
            if (!cancelled) {
              router.replace(nextPath);
            }
            return;
          }
        } catch {
          // Retry briefly; the callback cookie may not be visible to this page yet.
        }

        await new Promise((resolve) => window.setTimeout(resolve, 500));
        if (cancelled) {
          return;
        }
      }

      if (!cancelled) {
        setError("Miaowu 会话暂时无法确认，请重新授权登录。");
      }
    };

    void confirmSession();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-3 text-center">
        <img
          src="/brand/miaowu-logo.webp"
          alt="Miaowu OS"
          className="mx-auto size-16 rounded-2xl object-cover"
        />
        <h1 className="font-serif text-3xl">Miaowu OS</h1>
        <p className="text-muted-foreground text-sm">
          正在完成 NewAPI 授权...
        </p>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </main>
  );
}
