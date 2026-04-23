import { create } from "zustand";

import { decryptApiKeyWithStatus } from "./crypto";
import {
  fetchUserAiSettings,
  putUserAiSettings,
  type UserAiProviderRecord,
  type UserAiProviderRecordUpdate,
  type UserAiSettings,
  type UserAiSettingsUpdate,
} from "./useAiSettingsApi";

export type AiProviderType = "openai" | "anthropic" | "google" | "custom";

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderType;
  /**
   * Draft-only. Backend never returns API key.
   * - Non-empty => overwrite backend stored key
   * - Empty + hasApiKey=true => keep backend stored key (unless clearApiKey=true)
   */
  apiKey: string;
  baseUrl: string;
  models: string[];
  isActive: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Backend state hint (read-only). */
  hasApiKey?: boolean;
  /** Draft-only. Explicitly clear backend stored key. */
  clearApiKey?: boolean;
}

export interface AiGlobalSettings {
  defaultProviderId: string | null;
  providers: AiProviderConfig[];
  globalSystemPrompt: string;
  enableStreamMode: boolean;
  requestTimeout: number;
  maxRetries: number;
}

interface AiSettingsState {
  hydrated: boolean;
  hydrating: boolean;
  hydrationError: string | null;

  /**
   * Effective server-saved settings (single source of truth for chat runtime).
   * Never contains apiKey plaintext.
   */
  effective: AiGlobalSettings;
  /**
   * Draft settings for editing in UI. Only lives in memory (not persisted).
   */
  draft: AiGlobalSettings;
  isDirty: boolean;

  ensureHydrated: () => Promise<void>;
  refreshFromServer: () => Promise<void>;
  resetDraftToEffective: () => void;
  saveDraftToServer: () => Promise<void>;

  addProvider: (provider: AiProviderConfig) => void;
  updateProvider: (id: string, config: Partial<AiProviderConfig>) => void;
  deleteProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  setDefaultProvider: (id: string | null) => void;
  updateGlobalSettings: (settings: Partial<Omit<AiGlobalSettings, "providers">>) => void;

  /** Effective provider for runtime (chat/test-connection). */
  getEffectiveActiveProvider: () => AiProviderConfig | null;

  exportConfig: () => string;
  importConfig: (jsonText: string) => boolean;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: AiGlobalSettings = {
  defaultProviderId: null,
  providers: [],
  globalSystemPrompt: "",
  enableStreamMode: true,
  requestTimeout: 660000,
  maxRetries: 2,
};

function coerceProviderType(provider: string): AiProviderType {
  const trimmed = (provider || "").trim() as AiProviderType;
  if (trimmed === "openai" || trimmed === "anthropic" || trimmed === "google" || trimmed === "custom") {
    return trimmed;
  }
  return "custom";
}

function mapServerProviderToConfig(p: UserAiProviderRecord): AiProviderConfig {
  return {
    id: p.id,
    name: p.name,
    provider: coerceProviderType(p.provider),
    apiKey: "",
    baseUrl: p.base_url ?? "",
    models: Array.isArray(p.models) ? p.models : [],
    isActive: Boolean(p.is_active),
    temperature: p.temperature ?? undefined,
    maxTokens: p.max_tokens ?? undefined,
    hasApiKey: Boolean(p.has_api_key),
    clearApiKey: false,
  };
}

function mapServerSettingsToGlobal(settings: UserAiSettings): AiGlobalSettings {
  return {
    defaultProviderId: settings.default_provider_id ?? null,
    providers: (settings.providers ?? []).map(mapServerProviderToConfig),
    globalSystemPrompt: settings.system_prompt ?? "",
    enableStreamMode: Boolean(settings.client_settings?.enable_stream_mode),
    requestTimeout: Number(settings.client_settings?.request_timeout ?? DEFAULT_SETTINGS.requestTimeout),
    maxRetries: Number(settings.client_settings?.max_retries ?? DEFAULT_SETTINGS.maxRetries),
  };
}

function normalizeDraftSettings(draft: AiGlobalSettings): AiGlobalSettings {
  return {
    ...draft,
    requestTimeout: Number.isFinite(draft.requestTimeout) ? draft.requestTimeout : DEFAULT_SETTINGS.requestTimeout,
    maxRetries: Number.isFinite(draft.maxRetries) ? draft.maxRetries : DEFAULT_SETTINGS.maxRetries,
    enableStreamMode: Boolean(draft.enableStreamMode),
    globalSystemPrompt: draft.globalSystemPrompt ?? "",
    providers: Array.isArray(draft.providers) ? draft.providers : [],
  };
}

function buildPutPayloadFromDraft(draft: AiGlobalSettings): UserAiSettingsUpdate {
  const providers: UserAiProviderRecordUpdate[] = draft.providers.map((p) => {
    const apiKey = (p.apiKey || "").trim();
    const payload: UserAiProviderRecordUpdate = {
      id: p.id,
      name: p.name,
      provider: p.provider,
      base_url: p.baseUrl ?? "",
      models: Array.isArray(p.models) ? p.models : [],
      is_active: Boolean(p.isActive),
      temperature: p.temperature ?? null,
      max_tokens: p.maxTokens ?? null,
    };
    if (p.clearApiKey) {
      payload.clear_api_key = true;
    } else if (apiKey) {
      payload.api_key = apiKey;
    }
    return payload;
  });

  return {
    providers,
    default_provider_id: draft.defaultProviderId,
    client_settings: {
      enable_stream_mode: draft.enableStreamMode,
      request_timeout: draft.requestTimeout,
      max_retries: draft.maxRetries,
    },
    system_prompt: draft.globalSystemPrompt,
  };
}

function findActiveProvider(providers: AiProviderConfig[], defaultProviderId: string | null): AiProviderConfig | null {
  const explicit = providers.find((p) => p.isActive);
  if (explicit) return explicit;
  if (defaultProviderId) {
    const byId = providers.find((p) => p.id === defaultProviderId);
    if (byId) return byId;
  }
  return providers[0] ?? null;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readPersistedState<T = unknown>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (parsed && typeof parsed === "object" && "state" in (parsed as any)) {
    return (parsed as any).state as T;
  }
  return parsed as T;
}

function removeLocalProviderPersistenceAfterMigration(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("ai-provider-global-settings");
  } catch (err) {
    console.warn("Failed to remove ai-provider-global-settings:", err);
  }

  // For novelist-settings-storage, keep unrelated settings but clear provider secrets & list.
  try {
    const raw = window.localStorage.getItem("novelist-settings-storage");
    if (!raw) return;
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== "object") return;
    const container = parsed as any;
    const state = typeof container.state === "object" && container.state ? container.state : container;
    state.llmProviders = [];
    state.apiKey = "";
    state.customBaseUrl = "";
    state.customModelName = "";
    // keep llmProvider/model untouched (non-secret), user may still want defaults for other UI
    if (typeof container.state === "object" && container.state) {
      container.state = state;
    }
    window.localStorage.setItem("novelist-settings-storage", JSON.stringify(container));
  } catch (err) {
    console.warn("Failed to sanitize novelist-settings-storage:", err);
  }
}

async function tryMigrateLocalAiSettingsToServer(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const migratedFlag = window.localStorage.getItem("ai_settings_migrated_v1");
  if (migratedFlag === "true") return false;

  const globalState = readPersistedState<any>("ai-provider-global-settings");
  const novelistState = readPersistedState<any>("novelist-settings-storage");

  const source = globalState ?? novelistState;
  if (!source || typeof source !== "object") return false;

  const sourceProviders: any[] =
    Array.isArray(source.providers) ? source.providers :
      Array.isArray(source.llmProviders) ? source.llmProviders : [];

  if (!sourceProviders.length) return false;

  const defaultProviderId: string | null =
    typeof source.defaultProviderId === "string"
      ? source.defaultProviderId
      : null;

  const enableStreamMode = typeof source.enableStreamMode === "boolean"
    ? source.enableStreamMode
    : true;
  const requestTimeout = typeof source.requestTimeout === "number"
    ? source.requestTimeout
    : DEFAULT_SETTINGS.requestTimeout;
  const maxRetries = typeof source.maxRetries === "number"
    ? source.maxRetries
    : DEFAULT_SETTINGS.maxRetries;
  const systemPrompt = typeof source.globalSystemPrompt === "string"
    ? source.globalSystemPrompt
    : "";

  const providers: UserAiProviderRecordUpdate[] = sourceProviders
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const id = typeof p.id === "string" && p.id.trim() ? p.id.trim() : crypto.randomUUID();
      const name = typeof p.name === "string" ? p.name : "Provider";
      const provider = typeof p.provider === "string" ? p.provider : "openai";
      const baseUrl = typeof p.baseUrl === "string"
        ? p.baseUrl
        : typeof p.base_url === "string"
          ? p.base_url
          : "";
      const models = Array.isArray(p.models) ? p.models : [];
      const isActive = Boolean(p.isActive ?? p.is_active);
      const temperature = typeof p.temperature === "number" ? p.temperature : null;
      const maxTokens = typeof p.maxTokens === "number"
        ? p.maxTokens
        : typeof p.max_tokens === "number"
          ? p.max_tokens
          : null;

      const apiKeyRaw = typeof p.apiKey === "string" ? p.apiKey : typeof p.api_key === "string" ? p.api_key : "";
      const decrypted = decryptApiKeyWithStatus(apiKeyRaw);

      const record: UserAiProviderRecordUpdate = {
        id,
        name,
        provider,
        base_url: baseUrl,
        models,
        is_active: isActive,
        temperature,
        max_tokens: maxTokens,
      };

      if (decrypted.issue) {
        console.warn(`Skipping provider apiKey migration for ${id}: ${decrypted.issue.message}`);
      } else if (decrypted.value && decrypted.value.trim()) {
        record.api_key = decrypted.value.trim();
      }

      return record;
    });

  const payload: UserAiSettingsUpdate = {
    providers,
    default_provider_id: defaultProviderId,
    client_settings: {
      enable_stream_mode: enableStreamMode,
      request_timeout: requestTimeout,
      max_retries: maxRetries,
    },
    system_prompt: systemPrompt,
  };

  try {
    await putUserAiSettings(payload);
    window.localStorage.setItem("ai_settings_migrated_v1", "true");
    removeLocalProviderPersistenceAfterMigration();
    return true;
  } catch (err) {
    console.warn("AI settings migration failed:", err);
    return false;
  }
}

let _hydrationPromise: Promise<void> | null = null;

export const useAiProviderStore = create<AiSettingsState>()((set, get) => ({
  hydrated: false,
  hydrating: false,
  hydrationError: null,

  effective: { ...DEFAULT_SETTINGS },
  draft: { ...DEFAULT_SETTINGS },
  isDirty: false,

  ensureHydrated: async () => {
    if (get().hydrated) return;
    if (_hydrationPromise) return _hydrationPromise;

    _hydrationPromise = (async () => {
      await get().refreshFromServer();

      const effectiveProviders = get().effective.providers;
      if (effectiveProviders.length === 0) {
        const migrated = await tryMigrateLocalAiSettingsToServer();
        if (migrated) {
          await get().refreshFromServer();
        }
      }
    })()
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to hydrate AI settings";
        set({ hydrationError: message });
        throw err;
      })
      .finally(() => {
        _hydrationPromise = null;
      });

    return _hydrationPromise;
  },

  refreshFromServer: async () => {
    set({ hydrating: true, hydrationError: null });
    try {
      const server = await fetchUserAiSettings();
      const effective = mapServerSettingsToGlobal(server);
      set({
        hydrated: true,
        hydrating: false,
        hydrationError: null,
        effective,
        draft: effective,
        isDirty: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load AI settings";
      set({
        hydrated: false,
        hydrating: false,
        hydrationError: message,
      });
      throw err;
    }
  },

  resetDraftToEffective: () => {
    const effective = get().effective;
    set({ draft: effective, isDirty: false });
  },

  saveDraftToServer: async () => {
    const draft = normalizeDraftSettings(get().draft);
    const payload = buildPutPayloadFromDraft(draft);
    const server = await putUserAiSettings(payload);
    const effective = mapServerSettingsToGlobal(server);
    set({
      effective,
      draft: effective,
      isDirty: false,
      hydrationError: null,
      hydrated: true,
    });
  },

  addProvider: (provider) =>
    set((state) => ({
      draft: {
        ...state.draft,
        providers: [...state.draft.providers, provider],
      },
      isDirty: true,
    })),

  updateProvider: (id, config) =>
    set((state) => ({
      draft: {
        ...state.draft,
        providers: state.draft.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                ...config,
                clearApiKey: config.apiKey?.trim() ? false : config.clearApiKey ?? p.clearApiKey,
              }
            : p
        ),
      },
      isDirty: true,
    })),

  deleteProvider: (id) =>
    set((state) => ({
      draft: {
        ...state.draft,
        providers: state.draft.providers.filter((p) => p.id !== id),
      },
      isDirty: true,
    })),

  setActiveProvider: (id) =>
    set((state) => ({
      draft: {
        ...state.draft,
        defaultProviderId: id,
        providers: state.draft.providers.map((p) => ({
          ...p,
          isActive: p.id === id,
        })),
      },
      isDirty: true,
    })),

  setDefaultProvider: (id) =>
    set((state) => ({
      draft: {
        ...state.draft,
        defaultProviderId: id,
      },
      isDirty: true,
    })),

  updateGlobalSettings: (settings) =>
    set((state) => ({
      draft: {
        ...state.draft,
        ...settings,
      },
      isDirty: true,
    })),

  getEffectiveActiveProvider: () => {
    const state = get();
    return findActiveProvider(state.effective.providers, state.effective.defaultProviderId);
  },

  exportConfig: () => JSON.stringify(get().draft, null, 2),

  importConfig: (jsonText) => {
    const parsed = safeParseJson(jsonText);
    if (!parsed || typeof parsed !== "object") return false;
    const obj = parsed as Partial<AiGlobalSettings>;
    if (!Array.isArray(obj.providers)) return false;
    const draft: AiGlobalSettings = normalizeDraftSettings({
      ...DEFAULT_SETTINGS,
      ...obj,
      providers: obj.providers as AiProviderConfig[],
    });
    set({ draft, isDirty: true });
    return true;
  },

  resetToDefaults: () => {
    set({ draft: { ...DEFAULT_SETTINGS }, isDirty: true });
  },
}));

