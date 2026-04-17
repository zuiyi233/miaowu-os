import { getBackendBaseURL } from '@/core/config';

import type {
  BookImportPreview,
  BookImportTask,
  Chapter,
  Character,
  Career,
  Faction,
  Foreshadow,
  ForeshadowStats,
  GraphLayout,
  InspirationOption,
  Item,
  Novel,
  Setting,
  TimelineEvent,
} from './schemas';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
}

export interface NovelSummary {
  id: string | number;
  title: string;
  outline?: string;
  coverImage?: string;
  volumesCount: number;
  chaptersCount: number;
  wordCount: number;
}

const novelAuditActions = [
  'create',
  'update',
  'delete',
  'restore',
  'export',
  'import',
] as const;

const novelAuditEntityTypes = [
  'novel',
  'chapter',
  'entity',
  'character',
  'setting',
  'timeline',
  'graph',
  'relationship',
  'template',
  'interaction',
  'recommendation',
  'quality',
] as const;

export type NovelAuditAction = (typeof novelAuditActions)[number];
export type NovelAuditEntityType = (typeof novelAuditEntityTypes)[number];

export interface NovelAuditEntry {
  id: string;
  timestamp: Date;
  action: NovelAuditAction;
  entityType: NovelAuditEntityType;
  entityId: string;
  entityName: string;
  details: string;
  author: string;
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function toStringOr(value: unknown, fallback = ''): string {
  return toOptionalString(value) ?? fallback;
}

function getNovelApiPrefix() {
  const backendBase = getBackendBaseURL();
  return `${backendBase}/api`;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const prefix = getNovelApiPrefix();
  const base = `${prefix}${normalizedPath}`;

  if (!query) {
    return base;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    throw new ApiError(`Novel API request failed: ${response.status}`, response.status, payload);
  }

  return payload as T;
}

function normalizeNovel(raw: unknown): Novel {
  if (!isRecord(raw)) {
    return {
      id: '',
      title: 'Untitled',
      chapters: [],
      characters: [],
      settings: [],
      factions: [],
      items: [],
      volumes: [],
      relationships: [],
    } as Novel;
  }

  const entities = Array.isArray(raw.entities) ? raw.entities : [];

  const settings = entities.filter(
    (entity) => isRecord(entity) && (entity.type === 'setting' || entity.type === 'settings'),
  ) as Setting[];
  const factions = entities.filter(
    (entity) => isRecord(entity) && (entity.type === 'faction' || entity.type === 'factions'),
  ) as Faction[];
  const items = entities.filter(
    (entity) => isRecord(entity) && (entity.type === 'item' || entity.type === 'items'),
  ) as Item[];

  return {
    ...(raw as Novel),
    id: toStringOr(raw.id),
    title: toStringOr(raw.title),
    chapters: (Array.isArray(raw.chapters) ? raw.chapters : []) as Chapter[],
    characters: (Array.isArray(raw.characters) ? raw.characters : []) as Character[],
    settings,
    factions,
    items,
    volumes: (Array.isArray(raw.volumes) ? raw.volumes : []),
    relationships: (Array.isArray(raw.relationships) ? raw.relationships : []),
  } as Novel;
}

function normalizeNovelSummaries(raw: unknown): NovelSummary[] {
  if (Array.isArray(raw)) {
    return raw as NovelSummary[];
  }

  if (isRecord(raw) && Array.isArray(raw.items)) {
    return raw.items.map((item) => {
      if (!isRecord(item)) {
        return {
          id: '',
          title: 'Untitled',
          volumesCount: 0,
          chaptersCount: 0,
          wordCount: 0,
        };
      }

      return {
        id: toStringOr(item.id),
        title: toStringOr(item.title),
        outline: toOptionalString(item.outline),
        coverImage: toOptionalString(item.coverImage),
        volumesCount: Number(item.volumesCount ?? 0),
        chaptersCount: Number(item.chaptersCount ?? 0),
        wordCount: Number(item.wordCount ?? 0),
      };
    });
  }

  return [];
}

function normalizeGraphLayout(novelId: string, raw: unknown): GraphLayout {
  if (isRecord(raw)) {
    const lastUpdated = toOptionalString(raw.lastUpdated);
    return {
      ...(raw as GraphLayout),
      id: toStringOr(raw.id, novelId),
      novelId,
      nodePositions: isRecord(raw.nodePositions)
        ? (raw.nodePositions as GraphLayout['nodePositions'])
        : {},
      isLocked: Boolean(raw.isLocked),
      lastUpdated: lastUpdated ? new Date(lastUpdated) : new Date(),
    };
  }

  return {
    id: novelId,
    novelId,
    nodePositions: {},
    isLocked: false,
    lastUpdated: new Date(),
  };
}

function normalizeAuditEntry(
  novelId: string,
  raw: unknown,
  index: number,
): NovelAuditEntry {
  const fallbackTime = new Date();
  const fallbackId = `audit-${novelId}-${index}-${Math.random().toString(36).slice(2, 8)}`;

  if (!isRecord(raw)) {
    return {
      id: fallbackId,
      timestamp: fallbackTime,
      action: 'update',
      entityType: 'chapter',
      entityId: novelId,
      entityName: '未知实体',
      details: '检测到内容变更',
      author: 'system',
    };
  }

  const normalizeAction = (value: unknown): NovelAuditAction => {
    if (typeof value !== 'string') {
      return 'update';
    }
    if (novelAuditActions.includes(value as NovelAuditAction)) {
      return value as NovelAuditAction;
    }
    if (value.includes('create')) return 'create';
    if (value.includes('delete')) return 'delete';
    if (value.includes('restore')) return 'restore';
    if (value.includes('export')) return 'export';
    if (value.includes('import')) return 'import';
    return 'update';
  };

  const normalizeEntityType = (value: unknown): NovelAuditEntityType => {
    if (typeof value !== 'string') {
      return 'chapter';
    }
    if (novelAuditEntityTypes.includes(value as NovelAuditEntityType)) {
      return value as NovelAuditEntityType;
    }
    if (value.includes('novel')) return 'novel';
    if (value.includes('chapter')) return 'chapter';
    if (value.includes('entity')) return 'entity';
    if (value.includes('character')) return 'character';
    if (value.includes('setting')) return 'setting';
    if (value.includes('timeline')) return 'timeline';
    if (value.includes('graph')) return 'graph';
    if (value.includes('relationship')) return 'relationship';
    if (value.includes('template')) return 'template';
    if (value.includes('interaction') || value.includes('annotation')) return 'interaction';
    if (value.includes('recommendation')) return 'recommendation';
    if (value.includes('quality')) return 'quality';
    return 'chapter';
  };

  const normalizeDetails = (details: unknown): string => {
    if (typeof details === 'string') {
      return details;
    }
    if (isRecord(details) || Array.isArray(details)) {
      return JSON.stringify(details, null, 2);
    }
    return '检测到内容变更';
  };

  const detailRecord = isRecord(raw.details) ? raw.details : undefined;
  const action = normalizeAction(raw.action);
  const entityType = normalizeEntityType(raw.entityType);
  const rawTimestamp = toOptionalString(raw.timestamp) ?? '';
  const parsedTimestamp =
    raw.timestamp instanceof Date ? raw.timestamp : new Date(rawTimestamp);
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? fallbackTime : parsedTimestamp;

  return {
    id: typeof raw.id === 'string' ? raw.id : fallbackId,
    timestamp,
    action,
    entityType,
    entityId: typeof raw.entityId === 'string' ? raw.entityId : novelId,
    entityName:
      typeof raw.entityName === 'string'
        ? raw.entityName
        : typeof detailRecord?.name === 'string'
          ? detailRecord.name
          : typeof detailRecord?.title === 'string'
            ? detailRecord.title
            : '未命名实体',
    details: normalizeDetails(raw.details),
    author: typeof raw.author === 'string' ? raw.author : 'system',
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
    before: isRecord(raw.before) ? raw.before : undefined,
    after: isRecord(raw.after) ? raw.after : undefined,
  };
}

function normalizeAuditEntries(novelId: string, raw: unknown): NovelAuditEntry[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : [];

  return items
    .map((item, index) => normalizeAuditEntry(novelId, item, index))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function toEntityPayload(entity: Character | Setting | Faction | Item, type: string) {
  return {
    ...entity,
    type,
  };
}

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

export async function executeRemoteFirst<T>(
  remote: () => Promise<T>,
  fallback: () => Promise<T>,
  context: string,
  onRemoteSuccess?: (value: T) => Promise<void> | void,
): Promise<T> {
  try {
    const value = await remote();
    if (onRemoteSuccess) {
      await onRemoteSuccess(value);
    }
    return value;
  } catch (error) {
    console.warn(`[novel] remote failed in ${context}, fallback to local cache`, error);
    return fallback();
  }
}

export class NovelApiService {
  async getNovelByIdOrTitle(novelIdOrTitle: string): Promise<Novel | null> {
    if (!novelIdOrTitle) {
      return null;
    }

    try {
      const novel = await request<unknown>(`/novels/${encodeURIComponent(novelIdOrTitle)}`);
      return normalizeNovel(novel);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      const list = await this.getNovels();
      const hit = list.find(
        (item) => String(item.id) === novelIdOrTitle || item.title === novelIdOrTitle,
      );
      if (!hit) {
        return null;
      }

      const novel = await request<unknown>(`/novels/${encodeURIComponent(String(hit.id))}`);
      return normalizeNovel(novel);
    }
  }

  async getNovels(): Promise<NovelSummary[]> {
    const result = await request<unknown>('/novels');
    return normalizeNovelSummaries(result);
  }

  async createNovel(novel: Novel): Promise<Novel> {
    const result = await request<unknown>('/novels', {
      method: 'POST',
      body: novel,
    });
    return normalizeNovel(result);
  }

  async updateNovel(novelId: string | number, updates: Partial<Novel>): Promise<Novel> {
    const result = await request<unknown>(`/novels/${encodeURIComponent(String(novelId))}`, {
      method: 'PUT',
      body: updates,
    });
    return normalizeNovel(result);
  }

  async deleteNovel(novelId: string | number): Promise<void> {
    await request(`/novels/${encodeURIComponent(String(novelId))}`, {
      method: 'DELETE',
    });
  }

  async createChapter(novelId: string, chapter: Chapter): Promise<Chapter> {
    return request<Chapter>(`/novels/${encodeURIComponent(novelId)}/chapters`, {
      method: 'POST',
      body: chapter,
    });
  }

  async updateChapter(novelId: string, chapterId: string, updates: Partial<Chapter>): Promise<Chapter> {
    return request<Chapter>(
      `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`,
      {
        method: 'PUT',
        body: updates,
      },
    );
  }

  async deleteChapter(novelId: string, chapterId: string): Promise<void> {
    await request(
      `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async createCharacter(novelId: string, character: Character): Promise<Character> {
    return request<Character>(`/novels/${encodeURIComponent(novelId)}/entities`, {
      method: 'POST',
      body: toEntityPayload(character, 'character'),
    });
  }

  async updateCharacter(character: Character): Promise<Character> {
    return request<Character>(
      `/novels/${encodeURIComponent(character.novelId)}/entities/${encodeURIComponent(character.id)}`,
      {
        method: 'PUT',
        body: toEntityPayload(character, 'character'),
      },
    );
  }

  async createSetting(novelId: string, setting: Setting): Promise<Setting> {
    return request<Setting>(`/novels/${encodeURIComponent(novelId)}/entities`, {
      method: 'POST',
      body: toEntityPayload(setting, 'setting'),
    });
  }

  async updateSetting(setting: Setting): Promise<Setting> {
    return request<Setting>(
      `/novels/${encodeURIComponent(setting.novelId)}/entities/${encodeURIComponent(setting.id)}`,
      {
        method: 'PUT',
        body: toEntityPayload(setting, 'setting'),
      },
    );
  }

  async createFaction(novelId: string, faction: Faction): Promise<Faction> {
    return request<Faction>(`/novels/${encodeURIComponent(novelId)}/entities`, {
      method: 'POST',
      body: toEntityPayload(faction, 'faction'),
    });
  }

  async updateFaction(faction: Faction): Promise<Faction> {
    return request<Faction>(
      `/novels/${encodeURIComponent(faction.novelId)}/entities/${encodeURIComponent(faction.id)}`,
      {
        method: 'PUT',
        body: toEntityPayload(faction, 'faction'),
      },
    );
  }

  async createItem(novelId: string, item: Item): Promise<Item> {
    return request<Item>(`/novels/${encodeURIComponent(novelId)}/entities`, {
      method: 'POST',
      body: toEntityPayload(item, 'item'),
    });
  }

  async updateItem(item: Item): Promise<Item> {
    return request<Item>(
      `/novels/${encodeURIComponent(item.novelId)}/entities/${encodeURIComponent(item.id)}`,
      {
        method: 'PUT',
        body: toEntityPayload(item, 'item'),
      },
    );
  }

  async getTimelineEvents(novelId: string): Promise<TimelineEvent[]> {
    return request<TimelineEvent[]>(`/novels/${encodeURIComponent(novelId)}/timeline`);
  }

  async addTimelineEvent(novelId: string, event: TimelineEvent): Promise<TimelineEvent> {
    return request<TimelineEvent>(`/novels/${encodeURIComponent(novelId)}/timeline`, {
      method: 'POST',
      body: event,
    });
  }

  async updateTimelineEvent(novelId: string, eventId: string, event: Partial<TimelineEvent>): Promise<TimelineEvent> {
    return request<TimelineEvent>(
      `/novels/${encodeURIComponent(novelId)}/timeline/${encodeURIComponent(eventId)}`,
      {
        method: 'PUT',
        body: event,
      },
    );
  }

  async deleteTimelineEvent(novelId: string, eventId: string): Promise<void> {
    await request(
      `/novels/${encodeURIComponent(novelId)}/timeline/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async getGraphLayout(novelId: string): Promise<GraphLayout> {
    const result = await request<unknown>(`/novels/${encodeURIComponent(novelId)}/graph`);
    return normalizeGraphLayout(novelId, result);
  }

  async saveGraphLayout(layout: GraphLayout): Promise<GraphLayout> {
    const result = await request<unknown>(`/novels/${encodeURIComponent(layout.novelId)}/graph`, {
      method: 'PUT',
      body: layout,
    });
    return normalizeGraphLayout(layout.novelId, result);
  }

  async updateNodePositions(
    novelId: string,
    positions: Record<string, { x: number; y: number; fx?: number; fy?: number }>,
  ): Promise<GraphLayout> {
    const result = await request<unknown>(`/novels/${encodeURIComponent(novelId)}/graph`, {
      method: 'PUT',
      body: {
        nodePositions: positions,
      },
    });
    return normalizeGraphLayout(novelId, result);
  }

  async getRecommendations(novelId: string) {
    return request(`/novels/${encodeURIComponent(novelId)}/recommendations`);
  }

  async generateRecommendations(novelId: string, context?: unknown) {
    return request(`/novels/${encodeURIComponent(novelId)}/recommendations/generate`, {
      method: 'POST',
      body: context,
    });
  }

  async acceptRecommendation(novelId: string, recommendationId: string) {
    return request(
      `/novels/${encodeURIComponent(novelId)}/recommendations/${encodeURIComponent(recommendationId)}/accept`,
      {
        method: 'POST',
      },
    );
  }

  async getInteractions(novelId: string) {
    return request(`/novels/${encodeURIComponent(novelId)}/interactions`);
  }

  async createInteraction(novelId: string, interaction: unknown) {
    return request(`/novels/${encodeURIComponent(novelId)}/interactions`, {
      method: 'POST',
      body: interaction,
    });
  }

  async updateInteraction(novelId: string, interactionId: string, updates: unknown) {
    return request(
      `/novels/${encodeURIComponent(novelId)}/interactions/${encodeURIComponent(interactionId)}`,
      {
        method: 'PUT',
        body: updates,
      },
    );
  }

  async deleteInteraction(novelId: string, interactionId: string) {
    return request(
      `/novels/${encodeURIComponent(novelId)}/interactions/${encodeURIComponent(interactionId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async getQualityReport(novelId: string) {
    return request(`/novels/${encodeURIComponent(novelId)}/quality-report`);
  }

  async getAudits(novelId: string, limit = 200): Promise<NovelAuditEntry[]> {
    const result = await request<unknown>(`/novels/${encodeURIComponent(novelId)}/audits`, {
      query: { limit },
    });
    return normalizeAuditEntries(novelId, result);
  }

  async chat(
    novelId: string,
    payload: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    stream?: boolean;
    model_name?: string;
    temperature?: number;
    max_tokens?: number;
  }) {
    return request(`/novels/${encodeURIComponent(novelId)}/ai/chat`, {
      method: 'POST',
      body: payload,
    });
  }

  async getCareers(projectId: string): Promise<{ total: number; mainCareers: Career[]; subCareers: Career[] }> {
    const raw = await request<unknown>('/careers', { query: { project_id: projectId } });
    if (!isRecord(raw)) return { total: 0, mainCareers: [], subCareers: [] };
    return {
      total: Number(raw.total ?? 0),
      mainCareers: Array.isArray(raw.main_careers) ? raw.main_careers as Career[] : [],
      subCareers: Array.isArray(raw.sub_careers) ? raw.sub_careers as Career[] : [],
    };
  }

  async createCareer(data: Record<string, unknown>): Promise<unknown> {
    return request('/careers', { method: 'POST', body: data });
  }

  async updateCareer(careerId: string, data: Record<string, unknown>): Promise<unknown> {
    return request(`/careers/${encodeURIComponent(careerId)}`, { method: 'PUT', body: data });
  }

  async deleteCareer(careerId: string): Promise<void> {
    await request(`/careers/${encodeURIComponent(careerId)}`, { method: 'DELETE' });
  }

  async generateCareerSystem(projectId: string, params?: { mainCareerCount?: number; subCareerCount?: number; userRequirements?: string; enableMcp?: boolean }): Promise<Response> {
    const query: Record<string, QueryValue> = { project_id: projectId };
    if (params?.mainCareerCount) query.main_career_count = params.mainCareerCount;
    if (params?.subCareerCount) query.sub_career_count = params.subCareerCount;
    if (params?.userRequirements) query.user_requirements = params.userRequirements;
    if (params?.enableMcp !== undefined) query.enable_mcp = params.enableMcp;
    return fetch(buildUrl('/careers/generate-system', query));
  }

  async getForeshadows(projectId: string, params?: Record<string, QueryValue>): Promise<{ items: Foreshadow[]; total: number; stats?: ForeshadowStats }> {
    const query: Record<string, QueryValue> = { ...params };
    const raw = await request<unknown>(`/foreshadows/projects/${encodeURIComponent(projectId)}`, { query });
    if (!isRecord(raw)) return { items: [], total: 0 };
    return {
      items: Array.isArray(raw.items) ? raw.items as Foreshadow[] : [],
      total: Number(raw.total ?? 0),
      stats: isRecord(raw.stats) ? raw.stats as unknown as ForeshadowStats : undefined,
    };
  }

  async getForeshadowStats(projectId: string, currentChapter?: number): Promise<ForeshadowStats> {
    const query: Record<string, QueryValue> = {};
    if (currentChapter !== undefined) query.current_chapter = currentChapter;
    return request<ForeshadowStats>(`/foreshadows/projects/${encodeURIComponent(projectId)}/stats`, { query });
  }

  async createForeshadow(data: Record<string, unknown>): Promise<unknown> {
    return request('/foreshadows', { method: 'POST', body: data });
  }

  async updateForeshadow(foreshadowId: string, data: Record<string, unknown>): Promise<unknown> {
    return request(`/foreshadows/${encodeURIComponent(foreshadowId)}`, { method: 'PUT', body: data });
  }

  async deleteForeshadow(foreshadowId: string): Promise<void> {
    await request(`/foreshadows/${encodeURIComponent(foreshadowId)}`, { method: 'DELETE' });
  }

  async plantForeshadow(foreshadowId: string, data: Record<string, unknown>): Promise<unknown> {
    return request(`/foreshadows/${encodeURIComponent(foreshadowId)}/plant`, { method: 'POST', body: data });
  }

  async resolveForeshadow(foreshadowId: string, data: Record<string, unknown>): Promise<unknown> {
    return request(`/foreshadows/${encodeURIComponent(foreshadowId)}/resolve`, { method: 'POST', body: data });
  }

  async abandonForeshadow(foreshadowId: string, reason?: string): Promise<unknown> {
    return request(`/foreshadows/${encodeURIComponent(foreshadowId)}/abandon`, {
      method: 'POST',
      body: reason ? { reason } : {},
    });
  }

  async syncForeshadowsFromAnalysis(projectId: string, autoSetPlanted = true): Promise<unknown> {
    return request(`/foreshadows/projects/${encodeURIComponent(projectId)}/sync-from-analysis`, {
      method: 'POST',
      body: { auto_set_planted: autoSetPlanted },
    });
  }

  async generateInspirationOptions(step: string, context: Record<string, unknown>): Promise<InspirationOption> {
    const raw = await request<unknown>('/inspiration/generate-options', {
      method: 'POST',
      body: { step, context },
    });
    if (!isRecord(raw)) return { prompt: '', options: [] };
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      options: Array.isArray(raw.options) ? raw.options as string[] : [],
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async refineInspirationOptions(step: string, context: Record<string, unknown>, feedback: string, previousOptions: string[]): Promise<InspirationOption> {
    const raw = await request<unknown>('/inspiration/refine-options', {
      method: 'POST',
      body: { step, context, feedback, previous_options: previousOptions },
    });
    if (!isRecord(raw)) return { prompt: '', options: [] };
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      options: Array.isArray(raw.options) ? raw.options as string[] : [],
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async quickGenerateInspiration(params: Record<string, unknown>): Promise<InspirationOption> {
    const raw = await request<unknown>('/inspiration/quick-generate', {
      method: 'POST',
      body: params,
    });
    if (!isRecord(raw)) return { prompt: '', options: [] };
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      options: Array.isArray(raw.options) ? raw.options as string[] : [],
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async createBookImportTask(file: File, params: { extractMode: string; tailChapterCount: number }): Promise<{ taskId: string }> {
    const backendBase = getBackendBaseURL();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('extract_mode', params.extractMode);
    formData.append('tail_chapter_count', String(params.tailChapterCount));

    const response = await fetch(`${backendBase}/book-import/tasks`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new ApiError(`Book import task creation failed: ${response.status}`, response.status, errorText);
    }

    const result = await response.json();
    const taskId = isRecord(result) && typeof result.task_id === 'string' ? result.task_id : '';
    return { taskId };
  }

  async getBookImportTaskStatus(taskId: string): Promise<BookImportTask> {
    const raw = await request<unknown>(`/book-import/tasks/${encodeURIComponent(taskId)}`);
    if (!isRecord(raw)) return { taskId, status: 'pending', progress: 0, message: '' };
    return {
      taskId: typeof raw.task_id === 'string' ? raw.task_id : taskId,
      status: (typeof raw.status === 'string' ? raw.status : 'pending') as BookImportTask['status'],
      progress: Number(raw.progress ?? 0),
      message: typeof raw.message === 'string' ? raw.message : '',
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async getBookImportPreview(taskId: string): Promise<BookImportPreview> {
    return request<BookImportPreview>(`/book-import/tasks/${encodeURIComponent(taskId)}/preview`);
  }

  async applyBookImport(taskId: string, payload: Record<string, unknown>): Promise<unknown> {
    return request(`/book-import/tasks/${encodeURIComponent(taskId)}/apply`, {
      method: 'POST',
      body: payload,
    });
  }

  async applyBookImportStream(taskId: string, payload: Record<string, unknown>): Promise<Response> {
    const backendBase = getBackendBaseURL();
    return fetch(`${backendBase}/book-import/tasks/${encodeURIComponent(taskId)}/apply-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async cancelBookImportTask(taskId: string): Promise<void> {
    await request(`/book-import/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  }

  async retryBookImportStepsStream(taskId: string, steps: string[]): Promise<Response> {
    const backendBase = getBackendBaseURL();
    return fetch(`${backendBase}/book-import/tasks/${encodeURIComponent(taskId)}/retry-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ failed_steps: steps }),
    });
  }
}

export const novelApiService = new NovelApiService();
