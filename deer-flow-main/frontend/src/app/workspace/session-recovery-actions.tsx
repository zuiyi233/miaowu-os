"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { resolveApiUrl } from "@/core/api/fetcher";

interface SessionRecoveryActionsProps {
  loginUrl: string;
}

export function SessionRecoveryActions({
  loginUrl,
}: SessionRecoveryActionsProps) {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await fetch(resolveApiUrl("/api/v1/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } finally {
      window.location.replace(loginUrl);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button asChild>
        <a href={loginUrl}>重新使用 NewAPI 登录</a>
      </Button>
      <Button variant="outline" onClick={handleReset} disabled={resetting}>
        {resetting ? "正在清除..." : "清除本地会话"}
      </Button>
    </div>
  );
}
