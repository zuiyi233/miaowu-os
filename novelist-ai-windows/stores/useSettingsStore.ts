import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "../lib/storage/indexedDBStorage";
import { logger } from "../lib/logging";
import { generateUniqueId } from "../lib/utils/id";
import { LLMProviderConfig, ModelConfig } from "../types";

const STORE_CONTEXT = "SettingsStore";

/**
 * API 配置文件的接口 (保持向后兼容)
 * @deprecated 请使用 LLMProviderConfig
 */
export interface ApiConfig {
  id: string; // 唯一ID，例如使用 nanoid
  name: string; // 用户可读的名称，如 "官方 OpenAI", "我的代理"
  baseUrl: string;
  apiKey: string;
  // 用于测试连接的端点，默认为 /chat/completions
  testEndpoint?: string;
}

/**
 * 重新设计的应用设置接口
 * 遵循开放封闭原则，支持扩展而无需修改现有代码
 */
export interface AppSettings {
  // 编辑器设置 (保持不变)
  autoSaveEnabled: boolean;
  autoSaveDelay: number; // 毫秒
  autoSnapshotEnabled: boolean;
  editorFont: "Lora" | "Plus Jakarta Sans" | "Fira Code";
  editorFontSize: number; // 像素

  // --- AI 与 API 设置 (核心重构) ---

  // 1. 新的 LLM 服务商配置
  providers: LLMProviderConfig[];

  // 2. 保持向后兼容的 API 配置 (自动迁移)
  apiConfigs: ApiConfig[];
  activeApiConfigId: string | null; // 当前激活的配置ID

  // ✅ 新增：RAG 上下文 Token 限制
  contextTokenLimit: number;

  // ✅ 新增：中期记忆上下文窗口大小 (字符数)
  contextWindowSize: number;

  // ✅ 新增：缓存每个服务商的模型列表 { providerId: ['gpt-4', 'claude-3'] }
  providerModels: Record<string, string[]>;

  // ✅ 新增：RAG 高级配置
  ragOptions: {
    threshold: number; // 相似度阈值 (0-1)
    limit: number; // 单次检索最大数量 (Top K)
    enableRerank: boolean; // 是否启用重排序 (预留)
  };

  // 3. 分任务的模型精细化配置 (更新为使用 providerId)
  modelSettings: {
    outline: ModelConfig; // 大纲生成
    continue: ModelConfig; // 续写
    polish: ModelConfig; // 润色
    expand: ModelConfig; // 扩写
    condense: ModelConfig; // 简写
    rewrite: ModelConfig; // 改写
    chat: ModelConfig; // 自由对话
    extraction: ModelConfig; // 信息提取（关系、时间线）
    embedding: {
      // Embedding
      providerId: string;
      model: string;
    };
  };
}

/**
 * 设置状态接口
 * 遵循接口隔离原则，只定义必要的操作
 */
interface SettingsState extends AppSettings {
  setSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;

  // 保持向后兼容的 API 配置管理方法
  addApiConfig: (config: Omit<ApiConfig, "id">) => void;
  updateApiConfig: (id: string, updates: Partial<ApiConfig>) => void;
  removeApiConfig: (id: string) => void;

  // ✅ 新增：Provider 管理方法
  addProvider: (provider: Omit<LLMProviderConfig, "id">) => void;
  updateProvider: (id: string, updates: Partial<LLMProviderConfig>) => void;
  removeProvider: (id: string) => void;

  // 更新模型配置管理方法
  updateModelConfig: (
    task: keyof AppSettings["modelSettings"],
    config: Partial<ModelConfig | { providerId: string; model: string }>
  ) => void;

  // ✅ 新增：更新指定服务商的模型列表
  setProviderModels: (providerId: string, models: string[]) => void;

  // ✅ 新增：设置上下文窗口大小
  setContextWindowSize: (size: number) => void;

  // ✅ 新增：更新 RAG 配置
  setRagOptions: (options: Partial<AppSettings["ragOptions"]>) => void;
}

/**
 * 默认设置配置
 * 遵循开放封闭原则，便于扩展和修改默认值
 * 重构为支持多服务商配置和分任务模型精细化配置
 */
const defaultSettings: AppSettings = {
  // 编辑器默认设置
  autoSaveEnabled: true,
  autoSaveDelay: 5 * 60 * 1000, // 5分钟（300000毫秒）
  autoSnapshotEnabled: true,
  editorFont: "Lora",
  editorFontSize: 18,

  // 默认限制 64k，防止 Context Window 溢出
  contextTokenLimit: 64000,

  // ✅ 新增：默认 5000 字符 (约 3000-4000 tokens)，足够容纳 2-3 章原文
  contextWindowSize: 5000,

  // ✅ 新增：默认空对象
  providerModels: {},

  // ✅ RAG 默认值
  ragOptions: {
    threshold: 0.45, // 默认相似度阈值
    limit: 5, // 默认检索 5 条
    enableRerank: false,
  },

  // ✅ 新的 LLM 服务商默认配置
  providers: [
    {
      id: "default-newapi",
      name: "NewAPI (统一网关)",
      type: "openai", // NewAPI 对外暴露 OpenAI 格式
      baseUrl: "https://api.newapi.ai/v1", // 示例地址
      apiKey: "",
      enableReasoning: true, // 默认开启推理支持
      enableStreamOptions: true,
    },
  ],

  // 保持向后兼容的 API 配置 (自动迁移)
  apiConfigs: [
    {
      id: "default-gemini",
      name: "默认 Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      apiKey: "",
    },
    {
      id: "default-newapi",
      name: "默认 NewAPI/OpenAI 兼容",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
    },
  ],
  activeApiConfigId: "default-newapi",

  // ✅ 更新：模型设置现在关联到 Provider
  modelSettings: {
    outline: {
      providerId: "default-newapi",
      model: "gemini-2.0-flash-exp",
      temperature: 0.7,
      maxTokens: 16384, // ✅ 提升默认值
    },
    continue: {
      providerId: "default-newapi",
      model: "claude-3-5-sonnet-20241022",
      temperature: 0.8,
      maxTokens: 8192, // ✅ 提升默认值
    },
    polish: {
      providerId: "default-newapi",
      model: "deepseek-chat",
      temperature: 0.5,
      maxTokens: 8192, // ✅ 提升默认值
    },
    expand: {
      providerId: "default-newapi",
      model: "deepseek-reasoner",
      temperature: 0.7,
      maxTokens: 8192, // ✅ 提升默认值
    },
    condense: {
      providerId: "default-newapi",
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 8192,
    },
    rewrite: {
      providerId: "default-newapi",
      model: "deepseek-chat",
      temperature: 0.7,
      maxTokens: 8192,
    },
    chat: {
      providerId: "default-newapi",
      model: "gpt-4o",
      temperature: 0.7,
      maxTokens: 16384, // ✅ 提升默认值
    },
    extraction: {
      providerId: "default-newapi",
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 8192, // ✅ 提升默认值
    },
    embedding: {
      providerId: "default-newapi",
      model: "text-embedding-3-small",
    },
  },
};

/**
 * 设置状态管理器
 * 使用 Zustand 进行设置状态管理，支持持久化存储
 *
 * 设计原则应用：
 * - KISS: 简单直观的状态管理，只包含必要的配置和操作
 * - DRY: 统一的设置管理方式，避免重复的配置代码
 * - SOLID:
 *   - SRP: 专注于设置状态管理
 *   - OCP: 支持扩展新的设置项而无需修改现有代码
 *   - DIP: 依赖抽象的持久化存储接口而非具体实现
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,

      /**
       * 更新设置
       * 修改为深度合并 modelSettings，防止参数丢失
       */
      setSettings: (newSettings) => {
        logger.info(STORE_CONTEXT, "Updating settings", newSettings);

        set((state) => {
          // 深度合并 modelSettings
          let updatedModelSettings = state.modelSettings;

          if (newSettings.modelSettings) {
            updatedModelSettings = { ...state.modelSettings };
            // 遍历 newSettings.modelSettings 中的每个任务配置进行合并
            (
              Object.keys(newSettings.modelSettings) as Array<
                keyof AppSettings["modelSettings"]
              >
            ).forEach((key) => {
              // @ts-expect-error - TypeScript 难以推断这里的深度合并类型，但逻辑是安全的
              updatedModelSettings[key] = {
                ...updatedModelSettings[key],
                ...newSettings.modelSettings![key],
              };
            });
          }

          return {
            ...state,
            ...newSettings,
            modelSettings: updatedModelSettings,
          };
        });
      },

      /**
       * 重置所有设置为默认值
       */
      resetSettings: () => {
        logger.warn(STORE_CONTEXT, "Resetting all settings to default");
        set(defaultSettings);
      },

      /**
       * 添加新的 API 配置
       * 遵循单一职责原则，专注于 API 配置管理
       */
      addApiConfig: (config) => {
        const newConfig: ApiConfig = {
          ...config,
          id: generateUniqueId("api-config"),
        };
        logger.info(STORE_CONTEXT, "Adding new API config", {
          name: newConfig.name,
        });
        set((state) => ({
          apiConfigs: [...state.apiConfigs, newConfig],
        }));
      },

      /**
       * 更新现有 API 配置
       * 遵循单一职责原则，专注于 API 配置更新
       */
      updateApiConfig: (id, updates) => {
        logger.info(STORE_CONTEXT, "Updating API config", { id, updates });
        set((state) => ({
          apiConfigs: state.apiConfigs.map((config) =>
            config.id === id ? { ...config, ...updates } : config
          ),
        }));
      },

      /**
       * 删除 API 配置
       * 遵循单一职责原则，专注于 API 配置删除
       */
      removeApiConfig: (id) => {
        const state = get();
        logger.warn(STORE_CONTEXT, "Removing API config", { id });

        // 如果删除的是当前激活的配置，则切换到第一个可用配置
        const newConfigs = state.apiConfigs.filter(
          (config) => config.id !== id
        );
        const newActiveId =
          state.activeApiConfigId === id
            ? newConfigs.length > 0
              ? newConfigs[0].id
              : null
            : state.activeApiConfigId;

        set({
          apiConfigs: newConfigs,
          activeApiConfigId: newActiveId,
        });
      },

      /**
       * ✅ 新增：添加新的 Provider
       * 遵循单一职责原则，专注于 Provider 配置管理
       */
      addProvider: (provider) => {
        const newProvider = { ...provider, id: generateUniqueId("prov") };
        logger.info(STORE_CONTEXT, "Adding new provider", {
          name: newProvider.name,
        });
        set((state) => ({ providers: [...state.providers, newProvider] }));
      },

      /**
       * ✅ 新增：更新现有 Provider
       * 遵循单一职责原则，专注于 Provider 配置更新
       */
      updateProvider: (id, updates) => {
        logger.info(STORE_CONTEXT, "Updating provider", { id, updates });
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
      },

      /**
       * ✅ 新增：删除 Provider
       * 遵循单一职责原则，专注于 Provider 配置删除
       */
      removeProvider: (id) => {
        logger.warn(STORE_CONTEXT, "Removing provider", { id });
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
          // ✅ 可选：同时清理该 provider 的模型缓存
          providerModels: (() => {
            const { [id]: _, ...rest } = state.providerModels;
            return rest;
          })(),
        }));
      },

      /**
       * 更新模型配置
       * 遵循单一职责原则，专注于模型配置管理
       */
      updateModelConfig: (task, config) => {
        logger.info(STORE_CONTEXT, "Updating model config", { task, config });
        set((state) => ({
          modelSettings: {
            ...state.modelSettings,
            [task]: {
              ...state.modelSettings[task],
              ...config,
            },
          },
        }));
      },

      /**
       * ✅ 新增：实现设置模型列表的方法
       */
      setProviderModels: (providerId, models) => {
        logger.info(STORE_CONTEXT, "Updating provider models", {
          providerId,
          count: models.length,
        });
        set((state) => ({
          providerModels: {
            ...state.providerModels,
            [providerId]: models,
          },
        }));
      },

      /**
       * ✅ 新增：设置上下文窗口大小
       * 遵循单一职责原则，专注于上下文窗口大小管理
       */
      setContextWindowSize: (size) => {
        logger.info(STORE_CONTEXT, "Updating context window size", { size });
        set({ contextWindowSize: size });
      },

      // ✅ 新增实现
      setRagOptions: (options) => {
        logger.info(STORE_CONTEXT, "Updating RAG options", options);
        set((state) => ({
          ragOptions: { ...state.ragOptions, ...options },
        }));
      },
    }),
    {
      name: "mi-jing-novelist-settings", // 持久化存储的键名
      storage: createJSONStorage(() => indexedDBStorage), // 复用已有的 IndexedDB 适配器
      /**
       * 版本管理
       * 当设置结构发生变化时，可以在这里进行迁移
       */
      version: 8, // ✅ 升级版本号到 8，支持 condense/rewrite 任务
      /**
       * 迁移函数
       * 用于处理设置结构的向后兼容性
       */
      migrate: (persistedState: any, version: number) => {
        let state = persistedState;

        if (version === 0) {
          // 从版本 0 迁移到版本 1 的逻辑
          logger.info(STORE_CONTEXT, "Migrating settings from version 0 to 1");
          state = {
            ...defaultSettings,
            ...persistedState,
          };
        }

        if (version === 1) {
          // 从版本 1 迁移到版本 2：扁平化设置 -> 结构化设置
          logger.info(
            STORE_CONTEXT,
            "Migrating settings from version 1 to 2 (structured settings)"
          );

          const oldState = persistedState as any;

          // 将旧的扁平化设置迁移到新的结构化设置
          state = {
            // 保留编辑器设置
            autoSaveEnabled:
              oldState.autoSaveEnabled ?? defaultSettings.autoSaveEnabled,
            autoSaveDelay:
              oldState.autoSaveDelay ?? defaultSettings.autoSaveDelay,
            autoSnapshotEnabled:
              oldState.autoSnapshotEnabled ??
              defaultSettings.autoSnapshotEnabled,
            editorFont: oldState.editorFont ?? defaultSettings.editorFont,
            editorFontSize:
              oldState.editorFontSize ?? defaultSettings.editorFontSize,

            // 迁移 API 配置
            apiConfigs: [
              {
                id: "migrated-gemini",
                name: "Gemini API",
                baseUrl:
                  "https://generativelanguage.googleapis.com/v1beta/models",
                apiKey: oldState.geminiApiKey || "",
              },
              {
                id: "migrated-newapi",
                name: "NewAPI/OpenAI 兼容",
                baseUrl: oldState.apiBaseUrl || "https://api.openai.com/v1",
                apiKey: oldState.apiKey || "",
              },
            ],
            activeApiConfigId: "migrated-newapi",

            // 迁移模型配置
            modelSettings: {
              outline: {
                model: oldState.outlineModel || "gemini-2.5-flash",
                temperature: oldState.temperature ?? 0.7,
                maxTokens: oldState.maxOutputTokens ?? 4096,
              },
              continue: {
                model: oldState.continueWritingModel || "gemini-2.5-flash",
                temperature: oldState.temperature ?? 0.8,
                maxTokens: oldState.maxOutputTokens ?? 4096,
              },
              polish: {
                model: oldState.textProcessingModel || "deepseek-chat",
                temperature: oldState.temperature ?? 0.5,
                maxTokens: oldState.maxOutputTokens ?? 2048,
              },
              expand: {
                model: oldState.textProcessingModel || "deepseek-chat",
                temperature: oldState.temperature ?? 0.6,
                maxTokens: oldState.maxOutputTokens ?? 4096,
              },
              embedding: {
                model: oldState.embeddingModel || "text-embedding-3-small",
              },
            },
          };
        }

        // Version 2 -> 3: 补充缺失的 modelSettings
        if (version < 3) {
          logger.info(
            STORE_CONTEXT,
            "Migrating settings to version 3 (Add Chat/Extraction configs)"
          );

          state = {
            ...defaultSettings, // 先应用最新的默认值作为底板
            ...state, // 覆盖用户的旧设置
            modelSettings: {
              ...defaultSettings.modelSettings, // 确保拥有所有新字段
              ...(state.modelSettings || {}), // 恢复用户已有的字段
              // 强制补充缺失的关键字段，以防万一
              chat:
                state.modelSettings?.chat || defaultSettings.modelSettings.chat,
              extraction:
                state.modelSettings?.extraction ||
                defaultSettings.modelSettings.extraction,
            },
          };
        }

        // Version 3 -> 4: 迁移到新的 Provider 系统
        if (version < 4) {
          logger.info(
            STORE_CONTEXT,
            "Migrating settings to version 4 (New Provider System)"
          );

          state = {
            ...defaultSettings, // 先应用最新的默认值作为底板
            ...state, // 覆盖用户的旧设置
            providers: state.providers || defaultSettings.providers, // 确保有 providers 数组
            modelSettings: {
              ...defaultSettings.modelSettings, // 确保拥有所有新字段
              ...(state.modelSettings || {}), // 恢复用户已有的字段
            },
          };
        }

        // Version 4 -> 5: 添加 providerModels
        if (version < 5) {
          logger.info(
            STORE_CONTEXT,
            "Migrating settings to version 5 (Add providerModels cache)"
          );
          state = {
            ...state,
            providerModels: {},
          };
        }

        // Version 5 -> 6: 添加 contextWindowSize
        if (version < 6) {
          logger.info(
            STORE_CONTEXT,
            "Migrating settings to version 6 (Add contextWindowSize)"
          );
          state = {
            ...state,
            contextWindowSize:
              state.contextWindowSize || defaultSettings.contextWindowSize,
          };
        }

        // Version 6 -> 7: 添加 ragOptions
        if (version < 7) {
          logger.info(
            STORE_CONTEXT,
            "Migrating settings to version 7 (Add RAG options)"
          );
          state = {
            ...state,
            ragOptions: defaultSettings.ragOptions,
          };
        }

        // Version 7 -> 8: 添加 condense 和 rewrite 模型配置
        if (version < 8) {
          logger.info(
            STORE_CONTEXT,
            "Migrating settings to version 8 (Add condense/rewrite configs)"
          );
          state = {
            ...state,
            modelSettings: {
              ...defaultSettings.modelSettings,
              ...(state.modelSettings || {}),
            },
          };
        }

        return state;
      },
    }
  )
);

/**
 * 获取当前激活的 API 配置
 * 遵循单一职责原则，专注于获取激活配置
 */
export const useActiveApiConfig = () => {
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const activeApiConfigId = useSettingsStore(
    (state) => state.activeApiConfigId
  );

  return apiConfigs.find((config) => config.id === activeApiConfigId) || null;
};

/**
 * 获取特定任务的模型配置
 * 遵循单一职责原则，专注于获取任务特定配置
 */
export const useModelConfig = (task: keyof AppSettings["modelSettings"]) => {
  return useSettingsStore((state) => state.modelSettings[task]);
};

/**
 * ✅ 新增：获取指定任务的完整配置（包含 Provider 信息）
 * 遵循单一职责原则，专注于获取任务完整配置
 */
export const useTaskConfig = (task: keyof AppSettings["modelSettings"]) => {
  const settings = useSettingsStore();
  const modelConfig = settings.modelSettings[task];
  const provider = settings.providers.find(
    (p) => p.id === modelConfig.providerId
  );
  return { ...modelConfig, provider };
};
