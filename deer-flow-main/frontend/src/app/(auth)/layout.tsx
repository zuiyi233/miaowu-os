import Link from "next/link";
import { redirect } from "next/navigation";
import { type ReactNode } from "react";

import { AuthProvider } from "@/core/auth/AuthProvider";
import { getServerSideUser } from "@/core/auth/server";
import { assertNever } from "@/core/auth/types";

export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await getServerSideUser();

  switch (result.tag) {
    case "authenticated":
      redirect("/workspace");
    case "needs_setup":
      // Allow access to setup page
      return <AuthProvider initialUser={result.user}>{children}</AuthProvider>;
    case "system_setup_required":
    case "unauthenticated":
      return <AuthProvider initialUser={null}>{children}</AuthProvider>;
    case "gateway_unavailable":
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="space-y-2">
            <p className="text-foreground text-lg font-medium">
              NewAPI 登录服务暂时无法连接
            </p>
            <p className="text-muted-foreground max-w-md text-sm">
              请稍后重新进入 NewAPI 登录链路，或检查网关与 NewAPI OAuth 配置。
            </p>
          </div>
          <Link
            href="/login?next=%2Fworkspace"
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm"
          >
            重新使用 NewAPI 登录
          </Link>
        </div>
      );
    case "config_error":
      throw new Error(result.message);
    default:
      assertNever(result);
  }
}
