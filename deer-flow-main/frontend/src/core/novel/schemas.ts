import { z } from 'zod';

const embeddingMixin = {
  embedding: z.array(z.number()).optional(),
  lastEmbedded: z.number().optional(),
};

export const characterSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '角色名不能为空'),
  description: z.string().optional(),
  novelId: z.string().optional(),
  avatar: z.string().optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  backstory: z.string().optional(),
  factionId: z.string().optional(),
  ...embeddingMixin,
});

export const volumeSchema = z.object({
  id: z.string(),
  title: z.string().min(1, '卷标题不能为空'),
  description: z.string().optional(),
  chapters: z.array(z.any()).optional(),
  novelId: z.string().optional(),
  order: z.number().optional().default(0),
});

export const chapterSchema = z.object({
  id: z.string(),
  title: z.string().min(1, '章节标题不能为空'),
  content: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  volumeId: z.string().optional(),
  novelId: z.string().optional(),
  order: z.number().optional().default(0),
});

export const settingSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '场景名不能为空'),
  description: z.string().optional(),
  novelId: z.string().optional(),
  type: z.enum(['城市', '建筑', '自然景观', '地区', '其他']).default('其他'),
  atmosphere: z.string().optional(),
  history: z.string().optional(),
  keyFeatures: z.string().optional(),
  ...embeddingMixin,
});

export const factionSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '势力名称不能为空'),
  description: z.string().optional(),
  ideology: z.string().optional(),
  leaderId: z.string().optional(),
  novelId: z.string().optional(),
  goals: z.string().optional(),
  structure: z.string().optional(),
  resources: z.string().optional(),
  relationships: z.string().optional(),
  ...embeddingMixin,
});

export const relationshipSchema = z.object({
  id: z.string(),
  sourceId: z.string().min(1, '源实体ID不能为空'),
  targetId: z.string().min(1, '目标实体ID不能为空'),
  type: z.enum(['friend', 'enemy', 'family', 'lover', 'custom']),
  description: z.string().optional(),
  novelId: z.string().optional(),
});

export const itemSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '物品名称不能为空'),
  description: z.string().optional(),
  novelId: z.string().optional(),
  type: z.enum(['关键物品', '武器', '科技装置', '普通物品', '其他']).default('其他'),
  appearance: z.string().optional(),
  history: z.string().optional(),
  abilities: z.string().optional(),
  ownerId: z.string().optional(),
  ...embeddingMixin,
});

export const novelMetadataSchema = z.object({
  styleId: z.string().optional(),
  genreIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  wordCountId: z.string().optional(),
  customPrompt: z.string().optional(),
});

export const novelSchema = z.object({
  title: z.string().min(1, '小说标题不能为空'),
  outline: z.string().optional(),
  coverImage: z.string().optional(),
  metadata: novelMetadataSchema.optional(),
  volumes: z.array(volumeSchema).optional(),
  chapters: z.array(chapterSchema).optional(),
  characters: z.array(characterSchema).optional(),
  settings: z.array(settingSchema).optional(),
  factions: z.array(factionSchema).optional(),
  items: z.array(itemSchema).optional(),
  relationships: z.array(relationshipSchema).optional(),
});

export const promptTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1, '模板名称不能为空'),
  description: z.string().optional(),
  type: z.enum(['outline', 'continue', 'polish', 'expand', 'chat', 'extraction']),
  content: z.string().min(10, '提示词内容不能太短'),
  isBuiltIn: z.boolean().default(false),
  isActive: z.boolean().default(false),
});

export const timelineEventSchema = z.object({
  id: z.string(),
  novelId: z.string().min(1, '必须关联所属小说'),
  title: z.string().min(1, '事件标题不能为空'),
  description: z.string().optional(),
  dateDisplay: z.string(),
  sortValue: z.number(),
  relatedEntityIds: z.array(z.string()).optional(),
  relatedChapterId: z.string().optional(),
  type: z.enum(['backstory', 'plot', 'historical']).default('plot'),
});

export const graphLayoutSchema = z.object({
  id: z.string(),
  novelId: z.string().min(1, '必须关联所属小说'),
  nodePositions: z.record(
    z.string(),
    z.object({
      x: z.number(),
      y: z.number(),
      fx: z.number().optional(),
      fy: z.number().optional(),
    })
  ),
  isLocked: z.boolean().default(false),
  lastUpdated: z.date().default(() => new Date()),
});

export const chatSessionSchema = z.object({
  id: z.string(),
  novelId: z.string().optional(),
  title: z.string().optional(),
  messages: z.array(z.any()).optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export type Novel = z.infer<typeof novelSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Setting = z.infer<typeof settingSchema>;
export type Volume = z.infer<typeof volumeSchema>;
export type Faction = z.infer<typeof factionSchema>;
export type Item = z.infer<typeof itemSchema>;
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export type EntityRelationship = z.infer<typeof relationshipSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type GraphLayout = z.infer<typeof graphLayoutSchema>;
export type ChatSession = z.infer<typeof chatSessionSchema>;

export type CreateCharacter = Omit<Character, 'id'>;
export type CreateVolume = Omit<Volume, 'id'>;
export type CreateChapter = Omit<Chapter, 'id'>;
export type CreateSetting = Omit<Setting, 'id'>;
export type CreateFaction = Omit<Faction, 'id'>;
export type CreateItem = Omit<Item, 'id'>;
export type CreateTimelineEvent = Omit<TimelineEvent, 'id'>;

export const outlineNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  desc: z.string().optional(),
  type: z.enum(['volume', 'chapter']),
  isSelected: z.boolean(),
  children: z.array(z.lazy(() => outlineNodeSchema)).optional(),
});

export type OutlineNode = z.infer<typeof outlineNodeSchema>;
