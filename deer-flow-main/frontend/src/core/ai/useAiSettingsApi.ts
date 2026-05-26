import { useCallback, useEffect, useRef, useState } from "react";

import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { AiFeatureRoutingState } from "./feature-routing";

function getApiBase() {
  return getBackendBaseURL();
}

export interface UserAiClientSettings {
  enable_stream_mode: boolean;
  request_timeout: number;
  max_retries: number;
}

export interface UserAiProviderRecord {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  models: string[];
  is_active: boolean;
  temperature: number | null;
  max_tokens: number | null;
  has_api_key: boolean;
  is_managed?: boolean;
  managed_by?: string | null;
  managed_group?: string | null;
  model_groups?: Record<string, string[]>;
  model_sync_status?: string | null;
  model_sync_error?: string | null;
}

export interface UserAiSettings {
  // canonical fields
  providers: UserAiProviderRecord[];
  default_provider_id: string | null;
  client_settings: UserAiClientSettings;
  feature_routing_settings?: AiFeatureRoutingState | null;

  // legacy-compatible fields (still returned for compatibility)
  api_provider: string;
  api_base_url: string;
  llm_model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string | null;
}

export interface UserAiProviderRecordUpdate {
  id?: string | null;
  name: string;
  provider: string;
  base_url: string;
  models: string[];
  model_groups?: Record<string, string[]>;
  is_active: boolean;
  temperature?: number | null;
  max_tokens?: number | null;
  // write-only
  api_key?: string | null;
  clear_api_key?: boolean;
}

export interface UserAiSettingsUpdate {
  // new contract
  providers?: UserAiProviderRecordUpdate[];
  default_provider_id?: string | null;
  client_settings?: Partial<UserAiClientSettings>;
  feature_routing_settings?: AiFeatureRoutingState | null;

  // legacy fields
  api_provider?: string | null;
  api_key?: string | null;
  api_base_url?: string | null;
  llm_model?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  system_prompt?: string | null;
}

export interface NewApiSyncGroupItem {
  group_id: string;
  name: string;
  models: string[];
  model_count: number;
  provider_id: string;
  already_synced: boolean;
  has_api_key: boolean;
  model_sync_status?: string | null;
  model_sync_error?: string | null;
}

export interface NewApiSyncGroupsResponse {
  groups: NewApiSyncGroupItem[];
  manual_group_allowed: boolean;
  warnings: string[];
}

export interface NewApiSyncGroupResult {
  group_id: string;
  provider_id: string;
  model_count: number;
  has_api_key: boolean;
  status: string;
  error?: string | null;
}

export interface NewApiSyncGroupsApplyResponse {
  results: NewApiSyncGroupResult[];
  ai_settings: UserAiSettings;
}

export class ApiHttpError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string) {
    super(`API request failed (${status} ${statusText})`);
    this.name = "ApiHttpError";
    this.status = status;
    this.statusText = statusText;
  }
}

export async function fetchUserAiSettings(
  signal?: AbortSignal
): Promise<UserAiSettings> {
  const response = await fetch(`${getApiBase()}/api/user/ai-settings`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new ApiHttpError(response.status, response.statusText);
  }
  return (await response.json()) as UserAiSettings;
}

export async function putUserAiSettings(
  updates: UserAiSettingsUpdate,
  signal?: AbortSignal
): Promise<UserAiSettings> {
  const response = await fetchWithAuth(`${getApiBase()}/api/user/ai-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(updates),
    signal,
  });
  if (!response.ok) {
    throw new ApiHttpError(response.status, response.statusText);
  }
  return (await response.json()) as UserAiSettings;
}

export async function fetchNewApiSyncGroups(
  signal?: AbortSignal
): Promise<NewApiSyncGroupsResponse> {
  const response = await fetch(`${getApiBase()}/api/user/newapi-sync/groups`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new ApiHttpError(response.status, response.statusText);
  }
  return (await response.json()) as NewApiSyncGroupsResponse;
}

export async function syncNewApiGroups(
  payload: { groups?: string[]; manual_groups?: string[] },
  signal?: AbortSignal
): Promise<NewApiSyncGroupsApplyResponse> {
  const response = await fetchWithAuth(`${getApiBase()}/api/user/newapi-sync/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      groups: payload.groups ?? [],
      manual_groups: payload.manual_groups ?? [],
    }),
    signal,
  });
  if (!response.ok) {
    throw new ApiHttpError(response.status, response.statusText);
  }
  return (await response.json()) as NewApiSyncGroupsApplyResponse;
}

export function useAiSettingsApi() {
  const [settings, setSettings] = useState<UserAiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const settersRef = useRef({ setSettings, setLoading, setError });
  settersRef.current = { setSettings, setLoading, setError };

  const fetchSettings = useCallback(async () => {
    const { setSettings: ss, setLoading: sl, setError: se } = settersRef.current;
    sl(true);
    se(null);

    try {
      const data = await fetchUserAiSettings();
      ss(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load ai settings";
      se(message);
    } finally {
      sl(false);
    }
  }, []);

  const updateSettings = useCallback(
    async (updates: UserAiSettingsUpdate): Promise<boolean> => {
      const { setError: se } = settersRef.current;
      se(null);
      try {
        const data = await putUserAiSettings(updates);
        setSettings(data);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update ai settings";
        se(message);
        return false;
      }
    },
    []
  );

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, error, fetchSettings, updateSettings };
}
