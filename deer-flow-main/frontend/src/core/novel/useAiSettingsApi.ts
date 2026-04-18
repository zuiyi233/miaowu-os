import { useState, useEffect, useCallback, useRef } from 'react';
import { getBackendBaseURL } from '@/core/config';
import { retry } from '@/core/novel/utils/retry';

const API_BASE = getBackendBaseURL();

export interface AiSettings {
  api_provider: string;
  api_base_url: string;
  llm_model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string | null;
}

export interface AiSettingsUpdate {
  api_provider?: string | null;
  api_key?: string | null;
  api_base_url?: string | null;
  llm_model?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  system_prompt?: string | null;
}

class ApiHttpError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string) {
    super(`API request failed (${status} ${statusText})`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.statusText = statusText;
  }
}

function useAiSettingsApi() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const settersRef = useRef({ setSettings, setLoading, setError });
  settersRef.current = { setSettings, setLoading, setError };

  const fetchSettings = useCallback(async () => {
    const { setSettings: ss, setLoading: sl, setError: se } = settersRef.current;
    sl(true);
    se(null);

    const result = await retry(
      async () => {
        const response = await fetch(`${API_BASE}/api/user/ai-settings`, {
          credentials: 'include',
        });
        if (!response.ok) throw new ApiHttpError(response.status, response.statusText);
        return response.json();
      },
      { maxAttempts: 2 },
      'fetchSettings',
    );

    if (result.success && result.data) {
      ss(result.data);
    } else {
      se(result.error?.message ?? 'Failed to load settings');
    }

    sl(false);
  }, []);

  const updateSettings = useCallback(async (updates: AiSettingsUpdate): Promise<boolean> => {
    const { setError: se } = settersRef.current;
    se(null);

    const result = await retry(
      async () => {
        const response = await fetch(`${API_BASE}/api/user/ai-settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updates),
        });
        if (!response.ok) throw new ApiHttpError(response.status, response.statusText);
      },
      { maxAttempts: 2 },
      'updateSettings',
    );

    if (!result.success) {
      se(result.error?.message ?? 'Failed to update settings');
      return false;
    }

    await fetchSettings();
    return true;
  }, [fetchSettings]);

  useEffect(() => {
    fetchSettings();
  }, []);

  return { settings, loading, error, fetchSettings, updateSettings };
}

export { useAiSettingsApi };
