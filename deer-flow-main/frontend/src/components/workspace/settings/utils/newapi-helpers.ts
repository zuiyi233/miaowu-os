import type { AiProviderConfig } from "@/core/ai/ai-provider-store";
import { getBackendBaseURL } from "@/core/config";

const NEWAPI_SYNC_NEXT_PATH = "/workspace";

export function shouldValidateFetchModelsCredentials(providerType: string | undefined): boolean {
  return providerType === "openai" || providerType === "custom";
}

export function buildNewApiResyncUrl(): string {
  return `${getBackendBaseURL()}/api/v1/auth/login/newapi?next=${encodeURIComponent(NEWAPI_SYNC_NEXT_PATH)}`;
}

export function isNewApiManagedProvider(
  provider: Partial<Pick<AiProviderConfig, "isManaged" | "managedBy" | "id">> | undefined,
) {
  return (
    Boolean(provider?.isManaged && provider.managedBy === "newapi") ||
    provider?.id === "newapi-managed" ||
    Boolean(provider?.id?.startsWith("newapi-managed-"))
  );
}

export function normalizeManualGroups(value: string): string[] {
  return value
    .split(/[\n,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function newApiSyncStatusLabel(status?: string | null): string {
  switch (status) {
    case "synced":
      return "已同步";
    case "empty":
      return "无模型";
    case "error":
      return "失败";
    default:
      return "未同步";
  }
}
