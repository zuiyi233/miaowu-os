import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface LlmProviderConfig {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  category: "character" | "chapter" | "outline" | "continuation";
  isDefault: boolean;
}

interface SettingsState {
  llmProvider: string;
  apiKey: string;
  model: string;
  customModelName: string;
  customBaseUrl: string;
  llmProviders: LlmProviderConfig[];
  promptTemplates: PromptTemplate[];
  currentTemplateId: string;
  readingTheme?: string;
  readingFontSize?: number;
  readingLineHeight?: number;
  readingParagraphSpacing?: number;
  
  setLlmProvider: (provider: string) => void;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setCustomModelName: (name: string) => void;
  setCustomBaseUrl: (url: string) => void;
  setLlmProviders: (providers: LlmProviderConfig[]) => void;
  addLlmProvider: (provider: LlmProviderConfig) => void;
  updateLlmProvider: (id: string, config: Partial<LlmProviderConfig>) => void;
  deleteLlmProvider: (id: string) => void;
  
  setPromptTemplates: (templates: PromptTemplate[]) => void;
  setCurrentTemplateId: (id: string) => void;
  updatePromptTemplate: (id: string, template: Partial<PromptTemplate>) => void;
  addPromptTemplate: (template: PromptTemplate) => void;
  deletePromptTemplate: (id: string) => void;
  updateSettings: (updates: Partial<Pick<SettingsState, 'readingTheme' | 'readingFontSize' | 'readingLineHeight' | 'readingParagraphSpacing'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      llmProvider: "openai",
      apiKey: "",
      model: "gpt-4o-mini",
      customModelName: "",
      customBaseUrl: "",
      llmProviders: [],
      promptTemplates: [],
      currentTemplateId: "",
      
      setLlmProvider: (provider) => set({ llmProvider: provider }),
      setApiKey: (key) => set({ apiKey: key }),
      setModel: (model) => set({ model }),
      setCustomModelName: (name) => set({ customModelName: name }),
      setCustomBaseUrl: (url) => set({ customBaseUrl: url }),
      setLlmProviders: (providers) => set({ llmProviders: providers }),
      addLlmProvider: (provider) =>
        set((state) => ({
          llmProviders: [...state.llmProviders, provider],
        })),
      updateLlmProvider: (id, config) =>
        set((state) => ({
          llmProviders: state.llmProviders.map((p) =>
            p.id === id ? { ...p, ...config } : p
          ),
        })),
      deleteLlmProvider: (id) =>
        set((state) => ({
          llmProviders: state.llmProviders.filter((p) => p.id !== id),
        })),
      
      setPromptTemplates: (templates) => set({ promptTemplates: templates }),
      setCurrentTemplateId: (id) => set({ currentTemplateId: id }),
      updatePromptTemplate: (id, template) =>
        set((state) => ({
          promptTemplates: state.promptTemplates.map((t) =>
            t.id === id ? { ...t, ...template } : t
          ),
        })),
      addPromptTemplate: (template) =>
        set((state) => ({
          promptTemplates: [...state.promptTemplates, template],
        })),
      deletePromptTemplate: (id) =>
        set((state) => ({
          promptTemplates: state.promptTemplates.filter((t) => t.id !== id),
        })),
      updateSettings: (updates) => set((state) => ({ ...state, ...updates })),
    }),
    {
      name: "novelist-settings-storage",
    }
  )
);
