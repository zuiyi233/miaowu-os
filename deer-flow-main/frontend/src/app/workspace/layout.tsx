import { redirect } from "next/navigation";

import { AuthProvider } from "@/core/auth/AuthProvider";
import { getServerSideUser } from "@/core/auth/server";
import { assertNever } from "@/core/auth/types";

import { SessionRecoveryActions } from "./session-recovery-actions";
import { WorkspaceContent } from "./workspace-content";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const result = await getServerSideUser();

  switch (result.tag) {
    case "authenticated":
      return (
        <AuthProvider initialUser={result.user}>
          <WorkspaceContent>{children}</WorkspaceContent>
        </AuthProvider>
      );
    case "needs_setup":
      redirect("/setup");
    case "system_setup_required":
      redirect("/setup");
    case "unauthenticated":
      redirect("/login");
    case "gateway_unavailable":
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="space-y-2">
            <p className="text-foreground text-lg font-medium">
              NewAPI 会话暂时无法确认
            </p>
            <p className="text-muted-foreground max-w-md text-sm">
              可能是登录回调后的本地会话未写入，或浏览器里的旧会话已经失效。
            </p>
          </div>
          <SessionRecoveryActions loginUrl="/login?next=%2Fworkspace" />
        </div>
      );
    case "config_error":
      throw new Error(result.message);
    default:
      assertNever(result);
  }
}
