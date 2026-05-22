import { create } from "zustand";

import { decryptApiKeyWithStatus } from "./crypto";
import type { AiFeatureRoutingState } from "./feature-routing";
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
  featureRoutingSettings: AiFeatureRoutingState | null;
}

export interface AiSettingsState {
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
  saveFeatureRoutingToServer: (
    featureRoutingSettings: AiFeatureRoutingState | null
  ) => Promise<AiFeatureRoutingState | null>;

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
  featureRoutingSettings: null,
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
    featureRoutingSettings: settings.feature_routing_settings ?? null,
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
    featureRoutingSettings: draft.featureRoutingSettings ?? null,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumberOrNil(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

function isAiProviderType(value: unknown): value is AiProviderType {
  return value === "openai" || value === "anthropic" || value === "google" || value === "custom";
}

function isAiProviderConfigRecord(value: unknown): value is AiProviderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string" || !isAiProviderType(obj.provider)) {
    return false;
  }
  if (typeof obj.apiKey !== "string" || typeof obj.baseUrl !== "string") {
    return false;
  }
  if (!isStringArray(obj.models) || typeof obj.isActive !== "boolean") {
    return false;
  }
  if (!isFiniteNumberOrNil(obj.temperature) || !isFiniteNumberOrNil(obj.maxTokens)) {
    return false;
  }
  if (obj.hasApiKey !== undefined && typeof obj.hasApiKey !== "boolean") {
    return false;
  }
  if (obj.clearApiKey !== undefined && typeof obj.clearApiKey !== "boolean") {
    return false;
  }
  return true;
}

function isAiProviderConfigArray(value: unknown): value is AiProviderConfig[] {
  return Array.isArray(value) && value.every(isAiProviderConfigRecord);
}

function parseImportedDraftSettings(value: unknown): AiGlobalSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!isAiProviderConfigArray(source.providers)) return null;

  if (source.defaultProviderId !== undefined && source.defaultProviderId !== null && typeof source.defaultProviderId !== "string") {
    return null;
  }
  if (source.globalSystemPrompt !== undefined && typeof source.globalSystemPrompt !== "string") {
    return null;
  }
  if (source.enableStreamMode !== undefined && typeof source.enableStreamMode !== "boolean") {
    return null;
  }
  if (!isFiniteNumberOrNil(source.requestTimeout) || !isFiniteNumberOrNil(source.maxRetries)) {
    return null;
  }
  if (
    source.featureRoutingSettings !== undefined &&
    source.featureRoutingSettings !== null &&
    (typeof source.featureRoutingSettings !== "object" || Array.isArray(source.featureRoutingSettings))
  ) {
    return null;
  }

  return normalizeDraftSettings({
    ...DEFAULT_SETTINGS,
    defaultProviderId: typeof source.defaultProviderId === "string" ? source.defaultProviderId : null,
    providers: source.providers,
    globalSystemPrompt:
      typeof source.globalSystemPrompt === "string"
        ? source.globalSystemPrompt
        : DEFAULT_SETTINGS.globalSystemPrompt,
    enableStreamMode:
      typeof source.enableStreamMode === "boolean"
        ? source.enableStreamMode
        : DEFAULT_SETTINGS.enableStreamMode,
    requestTimeout:
      typeof source.requestTimeout === "number"
        ? source.requestTimeout
        : DEFAULT_SETTINGS.requestTimeout,
    maxRetries:
      typeof source.maxRetries === "number"
        ? source.maxRetries
        : DEFAULT_SETTINGS.maxRetries,
    featureRoutingSettings: (source.featureRoutingSettings as AiFeatureRoutingState | null | undefined) ?? null,
  });
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
    feature_routing_settings: draft.featureRoutingSettings,
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
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const container = parsed as { state?: unknown };
    if ("state" in container) {
      return container.state as T;
    }
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const container = parsed as Record<string, unknown> & { state?: unknown };
    const state =
      typeof container.state === "object" && container.state && !Array.isArray(container.state)
        ? (container.state as Record<string, unknown>)
        : container;
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

function generateMigrationProviderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseMigrationString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function parseMigrationNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function parseMigrationBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickLegacyProviders(source: Record<string, unknown>): unknown[] {
  if (Array.isArray(source.providers)) {
    return source.providers;
  }
  if (Array.isArray(source.llmProviders)) {
    return source.llmProviders;
  }
  return [];
}

function mapLegacyProviderToUpdate(provider: Record<string, unknown>): UserAiProviderRecordUpdate {
  const id = parseMigrationString(provider.id, "").trim() || generateMigrationProviderId();
  const apiKeyRaw = parseMigrationString(provider.apiKey ?? provider.api_key, "");
  const decrypted = decryptApiKeyWithStatus(apiKeyRaw);

  const record: UserAiProviderRecordUpdate = {
    id,
    name: parseMigrationString(provider.name, "Provider"),
    provider: parseMigrationString(provider.provider, "openai"),
    base_url: parseMigrationString(provider.baseUrl ?? provider.base_url, ""),
    models: Array.isArray(provider.models) ? provider.models : [],
    is_active: Boolean(provider.isActive ?? provider.is_active),
    temperature: typeof provider.temperature === "number" ? provider.temperature : null,
    max_tokens:
      typeof provider.maxTokens === "number"
        ? provider.maxTokens
        : typeof provider.max_tokens === "number"
          ? provider.max_tokens
          : null,
  };

  if (decrypted.issue) {
    console.warn(`Skipping provider apiKey migration for ${id}: ${decrypted.issue.message}`);
  } else if (decrypted.value?.trim()) {
    record.api_key = decrypted.value.trim();
  }

  return record;
}

export function buildMigrationPayloadFromLegacySource(
  source: Record<string, unknown>
): UserAiSettingsUpdate | null {
  const rawProviders = pickLegacyProviders(source);
  if (!rawProviders.length) {
    return null;
  }

  const providers = rawProviders
    .filter((provider): provider is Record<string, unknown> => Boolean(provider) && typeof provider === "object")
    .map(mapLegacyProviderToUpdate);
  if (!providers.length) {
    return null;
  }

  return {
    providers,
    default_provider_id:
      typeof source.defaultProviderId === "string" ? source.defaultProviderId : null,
    client_settings: {
      enable_stream_mode: parseMigrationBoolean(source.enableStreamMode, true),
      request_timeout: parseMigrationNumber(source.requestTimeout, DEFAULT_SETTINGS.requestTimeout),
      max_retries: parseMigrationNumber(source.maxRetries, DEFAULT_SETTINGS.maxRetries),
    },
    system_prompt: parseMigrationString(source.globalSystemPrompt, ""),
  };
}

async function tryMigrateLocalAiSettingsToServer(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const migratedFlag = window.localStorage.getItem("ai_settings_migrated_v1");
  if (migratedFlag === "true") return false;

  const globalState = readPersistedState<Record<string, unknown>>("ai-provider-global-settings");
  const novelistState = readPersistedState<Record<string, unknown>>("novelist-settings-storage");
  const source = globalState ?? novelistState;
  if (!source || typeof source !== "object") return false;

  const payload = buildMigrationPayloadFromLegacySource(source);
  if (!payload) return false;

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
    try {
      const { queryClient } = await import("../../components/query-client-provider");
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    } catch {}
  },

  saveFeatureRoutingToServer: async (featureRoutingSettings) => {
    const server = await putUserAiSettings({
      feature_routing_settings: featureRoutingSettings,
    });
    const persisted = server.feature_routing_settings ?? null;
    set((state) => ({
      hydrated: true,
      hydrationError: null,
      effective: {
        ...state.effective,
        featureRoutingSettings: persisted,
      },
      draft: {
        ...state.draft,
        featureRoutingSettings: persisted,
      },
    }));
    return persisted;
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

  exportConfig: () => {
    const draft = get().draft;
    const sanitized = {
      ...draft,
      providers: draft.providers.map((p) => {
        const { apiKey, ...rest } = p;
        void apiKey;
        return { ...rest, apiKey: "***" };
      }),
    };
    return JSON.stringify(sanitized, null, 2);
  },

  importConfig: (jsonText) => {
    const parsed = safeParseJson(jsonText);
    const draft = parseImportedDraftSettings(parsed);
    if (!draft) return false;
    set({ draft, isDirty: true });
    return true;
  },

  resetToDefaults: () => {
    set({ draft: { ...DEFAULT_SETTINGS }, isDirty: true });
  },
}));
