import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { FeatureFlagState, FeatureFlagsConfig } from "./type";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : `Request failed with status ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}

export async function loadFeatureFlags() {
  const response = await fetch(`${getBackendBaseURL()}/api/features`);
  return parseJsonResponse<FeatureFlagsConfig>(response);
}

export async function updateFeatureFlag(featureName: string, enabled: boolean) {
  const response = await fetch(
    `${getBackendBaseURL()}/api/features/${featureName}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled,
      }),
    },
  );
  return parseJsonResponse<FeatureFlagState>(response);
}
