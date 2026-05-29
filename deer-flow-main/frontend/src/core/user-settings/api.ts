import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

export interface UserUiSettings {
  version: number;
  media_draft_retention: "24h" | "7d" | "never";
}

export async function loadUserUiSettings() {
  const response = await fetch(`${getBackendBaseURL()}/api/user/ui-settings`);
  return response.json() as Promise<UserUiSettings>;
}

export async function updateUserUiSettings(payload: {
  media_draft_retention: "24h" | "7d" | "never";
  local_retention_candidate?: string | null;
}) {
  const response = await fetch(`${getBackendBaseURL()}/api/user/ui-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return response.json() as Promise<UserUiSettings>;
}
