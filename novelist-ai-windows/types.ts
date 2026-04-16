import { z } from "zod";
import {
  characterSchema,
  volumeSchema,
  chapterSchema,
  novelSchema,
  novelMetadataSchema,
  settingSchema,
  factionSchema,
  itemSchema,
  promptTemplateSchema,
  relationshipSchema,
  timelineEventSchema,
  graphLayoutSchema,
  createCharacterSchema,
  createVolumeSchema,
  createChapterSchema,
  createNovelSchema,
  createSettingSchema,
  createFactionSchema,
  createItemSchema,
  createPromptTemplateSchema,
  createRelationshipSchema,
  createTimelineEventSchema,
  createGraphLayoutSchema,
  createNovelFormSchema,
} from "./lib/schemas";

export type Theme = "light" | "dark" | "system";

// 使用 Zod 推断的类型，确保类型与验证逻辑完全同步
export type Character = z.infer<typeof characterSchema>;
export type Volume = z.infer<typeof volumeSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Novel = z.infer<typeof novelSchema>;
export type NovelMetadata = z.infer<typeof novelMetadataSchema>; // ✅ 新增：小说元数据类型
export type Setting = z.infer<typeof settingSchema>;
export type Faction = z.infer<typeof factionSchema>;
export type Item = z.infer<typeof itemSchema>;
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type EntityRelationship = z.infer<typeof relationshipSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type GraphLayout = z.infer<typeof graphLayoutSchema>;

// 创建表单专用的类型（不包含 id 字段）
export type CreateCharacter = z.infer<typeof createCharacterSchema>;
export type CreateVolume = z.infer<typeof createVolumeSchema>;
export type CreateChapter = z.infer<typeof createChapterSchema>;
export type CreateNovel = z.infer<typeof createNovelSchema>;
export type CreateSetting = z.infer<typeof createSettingSchema>;
export type CreateFaction = z.infer<typeof createFactionSchema>;
export type CreateItem = z.infer<typeof createItemSchema>;
export type CreatePromptTemplate = z.infer<typeof createPromptTemplateSchema>;
export type CreateRelationship = z.infer<typeof createRelationshipSchema>;
export type CreateTimelineEvent = z.infer<typeof createTimelineEventSchema>;
export type CreateGraphLayout = z.infer<typeof createGraphLayoutSchema>;

// ✅ 新增：小说创建表单专用的简化类型
export type CreateNovelForm = z.infer<typeof createNovelFormSchema>;

// ✅ 新增：LLM 服务商类型定义
export type LLMProviderType =
  | "openai"
  | "azure"
  | "anthropic"
  | "google"
  | "deepseek"
  | "custom";

// ✅ 新增：LLM 服务商配置接口
export interface LLMProviderConfig {
  id: string;
  name: string;
  type: LLMProviderType;
  baseUrl: string;
  apiKey: string;
  // 是否启用推理字段解析 (针对 DeepSeek R1 等)
  enableReasoning?: boolean;
  // 是否强制添加 stream_options (NewAPI 对某些模型需要此参数以返回 usage)
  enableStreamOptions?: boolean;
  // 自定义 Headers (如 anthropic-version)
  customHeaders?: Record<string, string>;
}

// ✅ 更新：模型配置接口，增加特定参数
export interface ModelConfig {
  providerId: string; // 关联到具体的 Provider
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  topK?: number; // Google/Anthropic 特有
  presencePenalty?: number;
  frequencyPenalty?: number;
}

// ✅ 新增：流式回调接口
export interface StreamCallbacks {
  onMessage: (content: string) => void;
  onReasoning?: (content: string) => void; // 思维链回调
  onThinking?: (isThinking: boolean) => void; // 思考状态回调
  onError?: (error: Error) => void;
  onFinish?: () => void;
}

// ✅ 新增：聊天消息类型
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string; // 思考过程
  timestamp: number;
  // 上下文引用
  contextEntities?: { type: string; name: string; id: string }[];
}

// ✅ 新增：聊天会话类型
export interface ChatSession {
  id: string;
  title: string;
  novelId?: string; // 关联的小说ID（可选，如果是全局对话则为空）
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ✅ 新增：大纲节点类型定义
export interface OutlineNode {
  id: string; // 临时 ID (如 "temp-vol-1")
  type: "volume" | "chapter";
  title: string;
  desc: string; // 对应 Volume.description 或 Chapter 的细纲
  parentId?: string; // 指向 Volume ID
  children?: OutlineNode[]; // 树状结构，方便前端渲染
  isSelected: boolean; // ✅ 对应你的 Checkbox 需求
  status?: "idle" | "generating" | "error"; // ✅ 新增状态字段
}
