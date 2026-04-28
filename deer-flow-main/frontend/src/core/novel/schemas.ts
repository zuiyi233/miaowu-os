import { z } from 'zod';

const embeddingMixin = {
  embedding: z.array(z.number()).optional(),
  lastEmbedded: z.number().optional(),
};

const lifecycleMixin = {
  syncStatus: z.enum(['local', 'syncing', 'synced', 'conflict', 'error']).optional(),
  version: z.number().int().positive().optional(),
  workflowState: z.enum(['draft', 'review', 'approved', 'archived']).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
};

const documentMetaMixin = {
  docPath: z.string().optional(),
  contentSource: z.literal('file').or(z.string()).optional(),
  contentHash: z.string().optional(),
  docUpdatedAt: z.string().datetime().optional(),
};

export const characterSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('char-')),
  name: z.string().min(1, '角色名不能为空'),
  description: z.string().optional(),
  novelId: z.string(),
  avatar: z.string().optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  motivation: z.string().optional(),
  backstory: z.string().optional(),
  factionId: z.string().optional(),
  ...embeddingMixin,
  ...documentMetaMixin,
  ...lifecycleMixin,
});

export const volumeSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('volume-')),
  title: z.string().min(1, '卷标题不能为空'),
  description: z.string().optional(),
  chapters: z.array(z.any()).optional(),
  novelId: z.string(),
  order: z.number().optional().default(0),
  ...lifecycleMixin,
});

export const chapterSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('chapter-')),
  title: z.string().min(1, '章节标题不能为空'),
  content: z.string().optional().default(''),
  description: z.string().optional(),
  summary: z.string().optional(),
  volumeId: z.string().optional(),
  novelId: z.string(),
  order: z.number().optional().default(0),
  wordCount: z.number().int().nonnegative().optional(),
  ...documentMetaMixin,
  ...lifecycleMixin,
});

export const outlineSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  novelId: z.string().optional(),
  title: z.string().min(1, '大纲标题不能为空'),
  content: z.string().optional(),
  summary: z.string().optional(),
  chapterNumber: z.number().int().positive().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  ...documentMetaMixin,
  ...lifecycleMixin,
});

export const settingSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('setting-')),
  name: z.string().min(1, '场景名不能为空'),
  description: z.string().optional(),
  novelId: z.string(),
  type: z.enum(['城市', '建筑', '自然景观', '地区', '其他']).default('其他'),
  atmosphere: z.string().optional(),
  history: z.string().optional(),
  keyFeatures: z.string().optional(),
  ...embeddingMixin,
  ...lifecycleMixin,
});

export const factionSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('faction-')),
  name: z.string().min(1, '势力名称不能为空'),
  description: z.string().optional(),
  ideology: z.string().optional(),
  leaderId: z.string().optional(),
  novelId: z.string(),
  goals: z.string().optional(),
  structure: z.string().optional(),
  resources: z.string().optional(),
  relationships: z.string().optional(),
  ...embeddingMixin,
  ...lifecycleMixin,
});

export const relationshipSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('rel-')),
  sourceId: z.string().min(1, '源实体ID不能为空'),
  targetId: z.string().min(1, '目标实体ID不能为空'),
  type: z.enum(['friend', 'enemy', 'family', 'lover', 'custom']),
  description: z.string().optional(),
  novelId: z.string(),
  ...lifecycleMixin,
});

export const itemSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('item-')),
  name: z.string().min(1, '物品名称不能为空'),
  description: z.string().optional(),
  novelId: z.string(),
  type: z.enum(['关键物品', '武器', '科技装置', '普通物品', '其他']).default('其他'),
  appearance: z.string().optional(),
  history: z.string().optional(),
  abilities: z.string().optional(),
  ownerId: z.string().optional(),
  ...embeddingMixin,
  ...lifecycleMixin,
});

export const novelMetadataSchema = z.object({
  styleId: z.string().optional(),
  genreIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  wordCountId: z.string().optional(),
  customPrompt: z.string().optional(),
});

export const novelSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('novel-')),
  title: z.string().min(1, '小说标题不能为空'),
  description: z.string().optional(),
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
  ...lifecycleMixin,
});

export const promptTemplateSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('template-')),
  name: z.string().min(1, '模板名称不能为空'),
  description: z.string().optional(),
  type: z.enum(['outline', 'continue', 'polish', 'expand', 'chat', 'extraction']),
  content: z.string().min(10, '提示词内容不能太短'),
  isBuiltIn: z.boolean().optional(),
  isActive: z.boolean().optional(),
  scope: z.enum(['global', 'novel', 'chapter']).optional(),
  novelId: z.string().optional(),
  ...lifecycleMixin,
});

export const timelineEventSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('timeline-')),
  novelId: z.string().min(1, '必须关联所属小说'),
  title: z.string().min(1, '事件标题不能为空'),
  description: z.string().optional(),
  dateDisplay: z.string(),
  sortValue: z.number(),
  relatedEntityIds: z.array(z.string()).optional(),
  relatedChapterId: z.string().optional(),
  type: z.enum(['backstory', 'plot', 'historical']).default('plot'),
  ...lifecycleMixin,
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
  ...lifecycleMixin,
});

export const chatSessionSchema = z.object({
  id: z.string(),
  novelId: z.string().optional(),
  title: z.string().optional(),
  messages: z.array(z.any()).optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const chapterSnapshotSchema = z.object({
  id: z.number().optional(),
  chapterId: z.string(),
  content: z.string(),
  timestamp: z.date(),
  description: z.string().optional(),
  version: z.number().int().positive().optional(),
  workflowState: z.enum(['draft', 'review', 'approved', 'archived']).optional(),
  author: z.string().optional(),
  changeReason: z.string().optional(),
});

export const annotationThreadSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('annotation-')),
  novelId: z.string(),
  chapterId: z.string(),
  anchorText: z.string().optional(),
  rangeStart: z.number().optional(),
  rangeEnd: z.number().optional(),
  title: z.string(),
  content: z.string(),
  type: z.enum(['annotation', 'ai_task', 'discussion']).default('annotation'),
  status: z.enum(['pending', 'in_progress', 'resolved', 'rejected', 'adopted']).default('pending'),
  mentions: z.array(z.string()).optional(),
  aiTask: z.object({
    prompt: z.string(),
    result: z.string().optional(),
    status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  }).optional(),
  parentId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const recommendationItemSchema = z.object({
  id: z.string().uuid().or(z.string().startsWith('rec-')),
  novelId: z.string(),
  type: z.enum(['plot_progression', 'character_consistency', 'narrative_pacing', 'foreshadowing', 'world_building', 'dialogue_improvement']),
  title: z.string(),
  content: z.string(),
  reason: z.string(),
  targetType: z.enum(['chapter', 'character', 'setting', 'plot', 'global']),
  targetId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'ignored']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().optional(),
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
export type ChapterSnapshot = z.infer<typeof chapterSnapshotSchema>;
export type AnnotationThread = z.infer<typeof annotationThreadSchema>;
export type RecommendationItem = z.infer<typeof recommendationItemSchema>;
export type Outline = z.infer<typeof outlineSchema>;

export type CreateCharacter = Omit<Character, 'id'>;
export type CreateVolume = Omit<Volume, 'id'>;
export type CreateChapter = Omit<Chapter, 'id'>;
export type CreateSetting = Omit<Setting, 'id'>;
export type CreateFaction = Omit<Faction, 'id'>;
export type CreateItem = Omit<Item, 'id'>;
export type CreateTimelineEvent = Omit<TimelineEvent, 'id'>;
export type CreateAnnotationThread = Omit<AnnotationThread, 'id' | 'createdAt' | 'updatedAt'>;
export type CreateRecommendationItem = Omit<RecommendationItem, 'id' | 'createdAt' | 'acceptedAt'>;

export const outlineNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  desc: z.string().optional(),
  type: z.enum(['volume', 'chapter']),
  status: z.enum(['idle', 'generating', 'error']).optional(),
  isSelected: z.boolean(),
  children: z.array(z.lazy(() => outlineNodeSchema)).optional(),
});

export type OutlineNode = z.infer<typeof outlineNodeSchema>;

export interface CareerStage {
  level: number;
  name: string;
  description?: string;
}

export interface Career {
  id: string;
  projectId: string;
  name: string;
  type: 'main' | 'sub';
  description?: string;
  category?: string;
  stages: CareerStage[];
  maxStage: number;
  requirements?: string;
  specialAbilities?: string;
  worldviewRules?: string;
  attributeBonuses?: Record<string, string>;
  source?: 'ai' | 'manual';
  createdAt?: string;
  updatedAt?: string;
}

export interface CharacterCareer {
  id: string;
  characterId: string;
  careerId: string;
  careerName: string;
  careerType: 'main' | 'sub';
  currentStage: number;
  stageName: string;
  stageDescription?: string;
  stageProgress: number;
  maxStage: number;
  startedAt?: string;
  reachedCurrentStageAt?: string;
  notes?: string;
}

export type ForeshadowStatus = 'pending' | 'planted' | 'resolved' | 'partially_resolved' | 'abandoned';

export interface Foreshadow {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category?: string;
  sourceChapter?: number;
  targetChapter?: number;
  isLongTerm: boolean;
  importance: number;
  status: ForeshadowStatus;
  sourceType: 'manual' | 'analysis';
  plantedChapter?: number;
  plantedContext?: string;
  resolvedChapter?: number;
  resolvedContext?: string;
  resolutionType?: 'full' | 'partial';
  abandonReason?: string;
  tags?: string[];
  relatedCharacters?: string[];
  hintText?: string;
  notes?: string;
  strength?: number;
  subtlety?: number;
  autoRemind?: boolean;
  remindBeforeChapters?: number;
  includeInContext?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ForeshadowStats {
  total: number;
  pending: number;
  planted: number;
  resolved: number;
  partiallyResolved: number;
  abandoned: number;
  longTermCount: number;
  overdueCount: number;
}

export type MemoryAnnotationType = 'hook' | 'foreshadow' | 'plot_point' | 'character_event';

export interface MemoryAnnotation {
  id: string;
  type: MemoryAnnotationType;
  title: string;
  content: string;
  importance: number;
  tags?: string[];
  metadata: {
    strength?: number;
    foreshadowType?: 'planted' | 'resolved';
    [key: string]: unknown;
  };
}

export interface InspirationOption {
  prompt: string;
  options: string[];
  error?: string;
}

export interface InspirationWizardData {
  title: string;
  description: string;
  theme: string;
  genre: string[];
  narrativePerspective: string;
  outlineMode: 'one-to-one' | 'one-to-many';
}

export type BookImportTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BookImportTask {
  taskId: string;
  status: BookImportTaskStatus;
  progress: number;
  message: string;
  error?: string;
}

export interface BookImportPreview {
  projectSuggestion: {
    title: string;
    genre: string;
    theme: string;
    description: string;
    narrativePerspective: string;
    targetWords: number;
  };
  chapters: BookImportChapter[];
  outlines: unknown[];
  warnings: BookImportWarning[];
}

export interface BookImportChapter {
  chapterNumber: number;
  title: string;
  summary: string;
  content: string;
}

export interface BookImportWarning {
  code: string;
  level: string;
  message: string;
}

export interface BookImportStepFailure {
  stepName: string;
  stepLabel: string;
  error: string;
  retryCount: number;
}
