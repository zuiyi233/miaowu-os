import { create } from "zustand";
import { persist } from "zustand/middleware";
import { encryptApiKey, decryptApiKey, isEncrypted } from "./crypto";

export type AiProviderType = "openai" | "anthropic" | "google" | "custom";

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderType;
  apiKey: string;
  baseUrl: string;
  models: string[];
  isActive: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface AiGlobalSettings {
  defaultProviderId: string | null;
  providers: AiProviderConfig[];
  globalSystemPrompt: string;
  enableStreamMode: boolean;
  requestTimeout: number;
  maxRetries: number;
}

interface AiSettingsState extends AiGlobalSettings {
  addProvider: (provider: AiProviderConfig) => void;
  updateProvider: (id: string, config: Partial<AiProviderConfig>) => void;
  deleteProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  setDefaultProvider: (id: string | null) => void;
  updateGlobalSettings: (settings: Partial<AiGlobalSettings>) => void;
  getActiveProvider: () => AiProviderConfig | null;
  getDecryptedApiKey: (providerId: string) => string;
  exportConfig: () => string;
  importConfig: (json: string) => boolean;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: AiGlobalSettings = {
  defaultProviderId: null,
  providers: [],
  globalSystemPrompt: "",
  enableStreamMode: true,
  requestTimeout: 120000,
  maxRetries: 2,
};

export const useAiProviderStore = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,

      addProvider: (provider) =>
        set((state) => ({
          providers: [
            ...state.providers,
            {
              ...provider,
              apiKey: provider.apiKey ? encryptApiKey(provider.apiKey) : "",
            },
          ],
          defaultProviderId: state.defaultProviderId || provider.id,
        })),

      updateProvider: (id, config) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...config,
                  apiKey: config.apiKey
                    ? encryptApiKey(config.apiKey)
                    : p.apiKey,
                }
              : p
          ),
        })),

      deleteProvider: (id) =>
        set((state) => {
          const newProviders = state.providers.filter((p) => p.id !== id);
          const newDefaultId =
            state.defaultProviderId === id
              ? newProviders[0]?.id || null
              : state.defaultProviderId;
          return {
            providers: newProviders,
            defaultProviderId: newDefaultId,
          };
        }),

      setActiveProvider: (id) =>
        set((state) => ({
          providers: state.providers.map((p) => ({
            ...p,
            isActive: p.id === id,
          })),
          defaultProviderId: id,
        })),

      setDefaultProvider: (id) => set({ defaultProviderId: id }),

      updateGlobalSettings: (settings) => set((state) => ({ ...state, ...settings })),

      getActiveProvider: () => {
        const state = get();
        const activeId = state.defaultProviderId;
        const provider = state.providers.find((p) => p.id === activeId);
        if (!provider) return null;

        return {
          ...provider,
          apiKey: decryptApiKey(provider.apiKey),
        };
      },

      getDecryptedApiKey: (providerId: string) => {
        const state = get();
        const provider = state.providers.find((p) => p.id === providerId);
        if (!provider || !provider.apiKey) return "";
        return decryptApiKey(provider.apiKey);
      },

      exportConfig: () => {
        const state = get();
        const exportData = {
          version: "1.0.0",
          exportedAt: new Date().toISOString(),
          settings: {
            globalSystemPrompt: state.globalSystemPrompt,
            enableStreamMode: state.enableStreamMode,
            requestTimeout: state.requestTimeout,
            maxRetries: state.maxRetries,
          },
          providers: state.providers.map((p) => ({
            ...p,
            apiKey: p.apiKey ? "***ENCRYPTED***" : "",
          })),
        };
        return JSON.stringify(exportData, null, 2);
      },

      importConfig: (json) => {
        try {
          const data = JSON.parse(json);
          if (!data.version || !Array.isArray(data.providers)) {
            return false;
          }

          const providers: AiProviderConfig[] = data.providers.map(
            (p: any) => ({
              ...p,
              apiKey:
                p.apiKey && p.apiKey !== "***ENCRYPTED***"
                  ? encryptApiKey(p.apiKey)
                  : "",
              isActive: false,
            })
          );

          set({
            providers,
            defaultProviderId: providers[0]?.id || null,
            ...(data.settings || {}),
          });
          return true;
        } catch {
          return false;
        }
      },

      resetToDefaults: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: "ai-provider-global-settings",
    }
  )
);
