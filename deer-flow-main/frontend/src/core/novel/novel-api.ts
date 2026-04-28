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
  Outline,
  Setting,
  TimelineEvent,
} from './schemas';
import { parseSseStream } from './utils';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface AiModelRoutingPayload {
  module_id?: string;
  ai_provider_id?: string;
  ai_model?: string;
}

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
}

interface StreamRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export type NovelStreamEvent = Record<string, unknown>;

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

export interface FinalizeGatePayload {
  low_score_warn_threshold?: number;
  low_score_block_threshold?: number;
  min_chapter_length_warn?: number;
  min_chapter_length_block?: number;
  sensitive_words?: string[];
}

export interface CareerSystemGenerationParams {
  mainCareerCount?: number;
  subCareerCount?: number;
  userRequirements?: string;
  enableMcp?: boolean;
}

export interface CareerSystemGenerationData {
  mainCareersCount: number;
  subCareersCount: number;
  mainCareers: string[];
  subCareers: string[];
}

export interface CareerSystemGenerationResult extends CareerSystemGenerationData {
  events: NovelStreamEvent[];
  rawResponse: Response;
  body: ReadableStream<Uint8Array> | null;
  ok: boolean;
  status: number;
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

let _cachedApiPrefix: string | undefined;
let _cachedPrefixBase: string | undefined;

function getNovelApiPrefix() {
  const backendBase = getBackendBaseURL();
  if (_cachedPrefixBase !== backendBase) {
    _cachedPrefixBase = backendBase;
    _cachedApiPrefix = `${backendBase}/api`;
  }
  return _cachedApiPrefix!;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  return buildUrlWithPrefix(getNovelApiPrefix(), path, query);
}

function buildUrlWithPrefix(prefix: string, path: string, query?: Record<string, QueryValue>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
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

function getBookImportApiPrefix() {
  const backendBase = getBackendBaseURL();
  return `${backendBase}/book-import`;
}

function buildBookImportUrl(path: string, query?: Record<string, QueryValue>) {
  return buildUrlWithPrefix(getBookImportApiPrefix(), path, query);
}

function withModelRoutingQuery(
  query: Record<string, QueryValue> | undefined,
  modelRouting?: AiModelRoutingPayload,
): Record<string, QueryValue> | undefined {
  const next: Record<string, QueryValue> = { ...(query ?? {}) };
  if (modelRouting?.module_id) {
    next.module_id = modelRouting.module_id;
  }
  if (modelRouting?.ai_provider_id) {
    next.ai_provider_id = modelRouting.ai_provider_id;
  }
  if (modelRouting?.ai_model) {
    next.ai_model = modelRouting.ai_model;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function withModelRoutingBody<T extends Record<string, unknown>>(
  body: T,
  modelRouting?: AiModelRoutingPayload,
): T & AiModelRoutingPayload {
  if (!modelRouting) {
    return body as T & AiModelRoutingPayload;
  }
  return {
    ...body,
    ...(modelRouting.module_id ? { module_id: modelRouting.module_id } : {}),
    ...(modelRouting.ai_provider_id ? { ai_provider_id: modelRouting.ai_provider_id } : {}),
    ...(modelRouting.ai_model ? { ai_model: modelRouting.ai_model } : {}),
  };
}

function parseJsonOrText(responseText: string): unknown {
  if (!responseText || !responseText.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const responseText = await response.text().catch(() => '');
  let payload = null;
  if (responseText && responseText.trim()) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      const responseSnippet = responseText.slice(0, 100);
      throw new ApiError(`Invalid JSON response at ${path}: ${responseSnippet}`, response.status);
    }
  }

  if (!response.ok) {
    throw new ApiError(`Novel API request failed: ${response.status}`, response.status, payload);
  }

  return payload as T;
}

async function requestBookImport<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildBookImportUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const responseText = await response.text();
  const payload = parseJsonOrText(responseText);

  if (!response.ok) {
    throw new ApiError(`Book import request failed: ${response.status}`, response.status, payload);
  }

  return payload as T;
}

async function requestStreamResponse(path: string, options: StreamRequestOptions = {}): Promise<Response> {
  const headers: HeadersInit = {
    Accept: 'text/event-stream',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let details: unknown = responseText;
    if (responseText && responseText.trim()) {
      try {
        details = JSON.parse(responseText);
      } catch {
        details = responseText;
      }
    }
    throw new ApiError(`Novel API stream request failed: ${response.status}`, response.status, details);
  }

  return response;
}

async function requestStream<T>(path: string, options: StreamRequestOptions = {}): Promise<AsyncGenerator<T>> {
  const response = await requestStreamResponse(path, options);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    async function* singlePayloadGenerator() {
      yield payload as T;
    }
    return singlePayloadGenerator();
  }

  if (!response.body) {
    throw new ApiError(`Novel API stream request has no response body at ${path}`, response.status);
  }

  return parseSseStream<T>(response.body);
}

async function requestStreamWith404Fallback<T>(
  primaryPath: string,
  fallbackPath: string | null,
  options: StreamRequestOptions = {},
): Promise<AsyncGenerator<T>> {
  try {
    return await requestStream<T>(primaryPath, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404 || !fallbackPath) {
      throw error;
    }
    return requestStream<T>(fallbackPath, options);
  }
}

function normalizeBookImportExtractMode(mode: string): 'tail' | 'full' {
  if (mode === 'full' || mode === 'full_book_reverse') {
    return 'full';
  }
  return 'tail';
}

function normalizeBookImportPreview(raw: unknown): BookImportPreview {
  if (!isRecord(raw)) {
    return {
      projectSuggestion: {
        title: '',
        genre: '',
        theme: '',
        description: '',
        narrativePerspective: '第三人称',
        targetWords: 100000,
      },
      chapters: [],
      outlines: [],
      warnings: [],
    };
  }

  const projectSuggestionRaw = isRecord(raw.project_suggestion)
    ? raw.project_suggestion
    : isRecord(raw.projectSuggestion)
      ? raw.projectSuggestion
      : {};

  const chaptersRaw = Array.isArray(raw.chapters) ? raw.chapters : [];
  const outlinesRaw = Array.isArray(raw.outlines) ? raw.outlines : [];
  const warningsRaw = Array.isArray(raw.warnings) ? raw.warnings : [];

  return {
    projectSuggestion: {
      title: toStringOr(projectSuggestionRaw.title),
      genre: toStringOr(projectSuggestionRaw.genre),
      theme: toStringOr(projectSuggestionRaw.theme),
      description: toStringOr(projectSuggestionRaw.description),
      narrativePerspective: toStringOr(
        projectSuggestionRaw.narrative_perspective ?? projectSuggestionRaw.narrativePerspective,
        '第三人称',
      ),
      targetWords: Number(projectSuggestionRaw.target_words ?? projectSuggestionRaw.targetWords ?? 100000),
    },
    chapters: chaptersRaw.map((chapter) => {
      const chapterRecord = isRecord(chapter) ? chapter : {};
      return {
        chapterNumber: Number(chapterRecord.chapter_number ?? chapterRecord.chapterNumber ?? 0),
        title: toStringOr(chapterRecord.title),
        summary: toStringOr(chapterRecord.summary),
        content: toStringOr(chapterRecord.content),
      };
    }),
    outlines: outlinesRaw,
    warnings: warningsRaw.map((warning) => {
      const warningRecord = isRecord(warning) ? warning : {};
      return {
        code: toStringOr(warningRecord.code),
        level: toStringOr(warningRecord.level),
        message: toStringOr(warningRecord.message),
      };
    }),
  };
}

function normalizeDocumentMeta(record: Record<string, unknown>) {
  const docPath = toOptionalString(record.docPath ?? record.doc_path);
  const contentSource = toOptionalString(record.contentSource ?? record.content_source);
  const contentHash = toOptionalString(record.contentHash ?? record.content_hash);
  const docUpdatedAt = toOptionalString(record.docUpdatedAt ?? record.doc_updated_at);

  return {
    ...(docPath ? { docPath } : {}),
    ...(contentSource ? { contentSource } : {}),
    ...(contentHash ? { contentHash } : {}),
    ...(docUpdatedAt ? { docUpdatedAt } : {}),
  };
}

function withNormalizedDocumentMeta<T>(value: T): T {
  if (!isRecord(value)) {
    return value;
  }
  return {
    ...value,
    ...normalizeDocumentMeta(value),
  } as T;
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

  const { settings, factions, items } = entities.reduce<{
    settings: Setting[];
    factions: Faction[];
    items: Item[];
  }>((acc, entity) => {
    if (!isRecord(entity)) return acc;
    const t = entity.type as string;
    if (t === 'setting' || t === 'settings') acc.settings.push(entity as Setting);
    else if (t === 'faction' || t === 'factions') acc.factions.push(entity as Faction);
    else if (t === 'item' || t === 'items') acc.items.push(entity as Item);
    return acc;
  }, { settings: [], factions: [], items: [] });

  return {
    ...(raw as Novel),
    id: toStringOr(raw.id),
    title: toStringOr(raw.title),
    chapters: (
      Array.isArray(raw.chapters) ? raw.chapters.map((item) => withNormalizedDocumentMeta(item)) : []
    ) as Chapter[],
    characters: (
      Array.isArray(raw.characters) ? raw.characters.map((item) => withNormalizedDocumentMeta(item)) : []
    ) as Character[],
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

  if (isRecord(raw)) {
    const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.projects) ? raw.projects : null;
    if (!items) {
      return [];
    }

    return items.map((item) => {
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
        outline: toOptionalString(item.outline ?? item.description),
        coverImage: toOptionalString(item.coverImage ?? item.cover_image_url),
        volumesCount: Number(item.volumesCount ?? 0),
        chaptersCount: Number(item.chaptersCount ?? item.chapter_count ?? 0),
        wordCount: Number(item.wordCount ?? item.current_words ?? 0),
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

const careerSystemResultKeys = [
  'main_careers_count',
  'mainCareersCount',
  'sub_careers_count',
  'subCareersCount',
  'main_careers',
  'mainCareers',
  'sub_careers',
  'subCareers',
] as const;

function hasCareerSystemResultKeys(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return careerSystemResultKeys.some((key) => key in value);
}

function toNumberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCareerNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const direct = toOptionalString(item);
      if (direct !== undefined) {
        return direct;
      }

      if (!isRecord(item)) {
        return '';
      }

      return toStringOr(item.name ?? item.title ?? item.id);
    })
    .filter((name) => Boolean(name.trim()));
}

function normalizeCareerSystemGenerationData(raw: unknown): CareerSystemGenerationData {
  if (!isRecord(raw)) {
    return {
      mainCareersCount: 0,
      subCareersCount: 0,
      mainCareers: [],
      subCareers: [],
    };
  }

  const mainCareers = normalizeCareerNameList(raw.main_careers ?? raw.mainCareers);
  const subCareers = normalizeCareerNameList(raw.sub_careers ?? raw.subCareers);

  return {
    mainCareersCount: toNumberOr(raw.main_careers_count ?? raw.mainCareersCount, mainCareers.length),
    subCareersCount: toNumberOr(raw.sub_careers_count ?? raw.subCareersCount, subCareers.length),
    mainCareers,
    subCareers,
  };
}

function parseCareerSystemGenerationResponseText(responseText: string): {
  data: CareerSystemGenerationData;
  events: NovelStreamEvent[];
} {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return {
      data: normalizeCareerSystemGenerationData(null),
      events: [],
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      const payload = isRecord(parsed.data) ? parsed.data : parsed;
      return {
        data: normalizeCareerSystemGenerationData(payload),
        events: [parsed as NovelStreamEvent],
      };
    }
  } catch {
    // Ignore and continue with SSE text parsing.
  }

  const events: NovelStreamEvent[] = [];
  let resultPayload: unknown = null;

  for (const line of trimmed.split('\n')) {
    const normalizedLine = line.trim();
    if (!normalizedLine.startsWith('data:')) {
      continue;
    }

    const payloadText = normalizedLine.slice(5).trim();
    if (!payloadText || payloadText === '[DONE]') {
      continue;
    }

    let parsedLine: unknown = null;
    try {
      parsedLine = JSON.parse(payloadText);
    } catch {
      continue;
    }

    if (!isRecord(parsedLine)) {
      continue;
    }

    events.push(parsedLine as NovelStreamEvent);

    const nestedPayload = isRecord(parsedLine.data) ? parsedLine.data : null;
    if (nestedPayload && hasCareerSystemResultKeys(nestedPayload)) {
      resultPayload = nestedPayload;
    } else if (hasCareerSystemResultKeys(parsedLine)) {
      resultPayload = parsedLine;
    }
  }

  return {
    data: normalizeCareerSystemGenerationData(resultPayload),
    events,
  };
}

function getResponseContentType(response: Response): string {
  const headers = response.headers;
  if (!headers || typeof headers.get !== 'function') {
    return '';
  }
  return headers.get('content-type') ?? '';
}

function shouldEagerlyParseCareerSystemResponse(response: Response): boolean {
  const contentType = getResponseContentType(response).toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return false;
  }

  if (!response.body) {
    return true;
  }

  return contentType.includes('application/json');
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
      try {
        await onRemoteSuccess(value);
      } catch (syncError) {
        console.warn(`[novel] onRemoteSuccess failed in ${context}`, syncError);
      }
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

  async deleteNovel(novelId: string | number): Promise<boolean> {
    await request(`/novels/${encodeURIComponent(String(novelId))}`, {
      method: 'DELETE',
    });
    return true;
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

  async generateChapterStream(
    novelId: string,
    chapterId: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<NovelStreamEvent>> {
    return requestStreamWith404Fallback<NovelStreamEvent>(
      `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/generate-stream`,
      `/chapters/${encodeURIComponent(chapterId)}/generate-stream`,
      {
        method: 'POST',
        body: params,
        signal,
      },
    );
  }

  async continueChapterStream(
    novelId: string,
    chapterId: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<NovelStreamEvent>> {
    try {
      return await requestStreamWith404Fallback<NovelStreamEvent>(
        `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/continue-stream`,
        `/chapters/${encodeURIComponent(chapterId)}/continue-stream`,
        {
          method: 'POST',
          body: params,
          signal,
        },
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      return this.generateChapterStream(
        novelId,
        chapterId,
        params,
        signal,
      );
    }
  }

  async regenerateChapterStream(
    novelId: string,
    chapterId: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<NovelStreamEvent>> {
    try {
      return await requestStreamWith404Fallback<NovelStreamEvent>(
        `/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(chapterId)}/regenerate-stream`,
        `/chapters/${encodeURIComponent(chapterId)}/regenerate-stream`,
        {
          method: 'POST',
          body: params,
          signal,
        },
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      return this.generateChapterStream(
        novelId,
        chapterId,
        {
          mode: 'regenerate',
          ...params,
        },
        signal,
      );
    }
  }

  async batchGenerateChaptersStream(
    novelId: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<NovelStreamEvent>> {
    return requestStreamWith404Fallback<NovelStreamEvent>(
      `/novels/${encodeURIComponent(novelId)}/chapters/batch-generate-stream`,
      `/chapters/project/${encodeURIComponent(novelId)}/batch-generate`,
      {
        method: 'POST',
        body: params,
        signal,
      },
    );
  }

  async generateOutlinesStream(
    novelId: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<NovelStreamEvent>> {
    const streamPayload = {
      project_id: novelId,
      ...params,
    };
    try {
      return await requestStreamWith404Fallback<NovelStreamEvent>(
        `/novels/${encodeURIComponent(novelId)}/outlines/generate-stream`,
        '/outlines/generate-stream',
        {
          method: 'POST',
          body: streamPayload,
          signal,
        },
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      return requestStream<NovelStreamEvent>('/wizard-stream/outline', {
        method: 'POST',
        body: streamPayload,
        signal,
      });
    }
  }

  async generateCharactersStream(
    novelId: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<NovelStreamEvent>> {
    const streamPayload = {
      project_id: novelId,
      ...params,
    };
    try {
      return await requestStreamWith404Fallback<NovelStreamEvent>(
        `/novels/${encodeURIComponent(novelId)}/characters/generate-stream`,
        '/characters/generate-stream',
        {
          method: 'POST',
          body: streamPayload,
          signal,
        },
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      return requestStream<NovelStreamEvent>('/wizard-stream/characters', {
        method: 'POST',
        body: streamPayload,
        signal,
      });
    }
  }

  async analyzeChapter(novelId: string, chapterId: string): Promise<unknown> {
    return request(`/memories/projects/${encodeURIComponent(novelId)}/analyze-chapter/${encodeURIComponent(chapterId)}`, {
      method: 'POST',
    });
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

  async deleteCharacter(novelId: string, characterId: string): Promise<void> {
    await request(
      `/novels/${encodeURIComponent(novelId)}/entities/${encodeURIComponent(characterId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async getCharacters(novelId: string): Promise<Character[]> {
    const novel = await this.getNovelCached(novelId);
    return novel?.characters ?? [];
  }

  async getChapters(novelId: string): Promise<Chapter[]> {
    const novel = await this.getNovelCached(novelId);
    return novel?.chapters ?? [];
  }

  private _novelCache = new Map<string, { data: Novel; ts: number }>();
  private static CACHE_TTL = 30_000;

  async getNovelCached(novelId: string): Promise<Novel | null> {
    const cached = this._novelCache.get(novelId);
    if (cached && Date.now() - cached.ts < NovelApiService.CACHE_TTL) {
      return cached.data;
    }
    const novel = await this.getNovelByIdOrTitle(novelId);
    if (novel) {
      this._novelCache.set(novelId, { data: novel, ts: Date.now() });
    }
    return novel;
  }

  clearNovelCache(novelId?: string) {
    if (novelId) this._novelCache.delete(novelId);
    else this._novelCache.clear();
  }

  async getOutlines(novelId: string): Promise<Outline[]> {
    try {
      const raw = await request<unknown>('/outlines', {
        query: { project_id: novelId },
      });

      if (Array.isArray(raw)) {
        return raw.map((item) => withNormalizedDocumentMeta(item as Outline)) as Outline[];
      }

      if (isRecord(raw) && Array.isArray(raw.items)) {
        return raw.items.map((item) => withNormalizedDocumentMeta(item as Outline)) as Outline[];
      }

      return [];
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
      return [];
    }
  }

  async createOutline(novelId: string, outline: Outline): Promise<Outline> {
    const created = await request<Outline>('/outlines', {
      method: 'POST',
      body: {
        project_id: novelId,
        ...outline,
      },
    });
    return withNormalizedDocumentMeta(created);
  }

  async updateOutline(outlineId: string, updates: Partial<Outline>): Promise<Outline> {
    const updated = await request<Outline>(`/outlines/${encodeURIComponent(outlineId)}`, {
      method: 'PUT',
      body: updates,
    });
    return withNormalizedDocumentMeta(updated);
  }

  async deleteOutline(outlineId: string): Promise<void> {
    await request(`/outlines/${encodeURIComponent(outlineId)}`, {
      method: 'DELETE',
    });
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

  async ignoreRecommendation(novelId: string, recommendationId: string) {
    return request(
      `/novels/${encodeURIComponent(novelId)}/recommendations/${encodeURIComponent(recommendationId)}/ignore`,
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

  async getConsistencyReport(projectId: string) {
    return request(`/polish/projects/${encodeURIComponent(projectId)}/consistency-report`);
  }

  async checkFinalizeGate(projectId: string, payload?: FinalizeGatePayload) {
    return request(`/polish/projects/${encodeURIComponent(projectId)}/finalize-gate`, {
      method: 'POST',
      body: payload,
    });
  }

  async finalizeProject(projectId: string, payload?: FinalizeGatePayload) {
    try {
      return await request(`/polish/projects/${encodeURIComponent(projectId)}/finalize`, {
        method: 'POST',
        body: payload,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isRecord(error.details)) {
        const detail = isRecord(error.details.detail) ? error.details.detail : null;
        if (detail && 'gate_report' in detail) {
          throw new ApiError(error.message, error.status, {
            ...error.details,
            gate_report: detail.gate_report,
          });
        }
      }
      throw error;
    }
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

  async getCareers(
    projectId: string,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<{ total: number; mainCareers: Career[]; subCareers: Career[] }> {
    const raw = await request<unknown>('/careers', {
      query: withModelRoutingQuery({ project_id: projectId }, modelRouting),
    });
    if (!isRecord(raw)) return { total: 0, mainCareers: [], subCareers: [] };
    return {
      total: Number(raw.total ?? 0),
      mainCareers: Array.isArray(raw.main_careers) ? raw.main_careers as Career[] : [],
      subCareers: Array.isArray(raw.sub_careers) ? raw.sub_careers as Career[] : [],
    };
  }

  async createCareer(data: Record<string, unknown>, modelRouting?: AiModelRoutingPayload): Promise<unknown> {
    return request('/careers', {
      method: 'POST',
      body: withModelRoutingBody(data, modelRouting),
    });
  }

  async updateCareer(
    careerId: string,
    data: Record<string, unknown>,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<unknown> {
    return request(`/careers/${encodeURIComponent(careerId)}`, {
      method: 'PUT',
      body: withModelRoutingBody(data, modelRouting),
    });
  }

  async deleteCareer(careerId: string): Promise<void> {
    await request(`/careers/${encodeURIComponent(careerId)}`, { method: 'DELETE' });
  }

  async generateCareerSystem(
    projectId: string,
    params?: CareerSystemGenerationParams,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<CareerSystemGenerationResult> {
    const query: Record<string, QueryValue> = withModelRoutingQuery(
      { project_id: projectId },
      modelRouting,
    ) ?? {};
    if (params?.mainCareerCount !== undefined) query.main_career_count = params.mainCareerCount;
    if (params?.subCareerCount !== undefined) query.sub_career_count = params.subCareerCount;
    if (params?.userRequirements) query.user_requirements = params.userRequirements;
    if (params?.enableMcp !== undefined) query.enable_mcp = params.enableMcp;

    const response = await requestStreamResponse('/careers/generate-system', { method: 'GET', query });
    const shouldEagerlyParse = shouldEagerlyParseCareerSystemResponse(response);
    let cachedText: string | null = null;
    const readResponseText = async () => {
      if (cachedText !== null) {
        return cachedText;
      }
      const parseSource = typeof response.clone === 'function' ? response.clone() : response;
      cachedText = await parseSource.text().catch(() => '');
      return cachedText;
    };

    if (!response.ok) {
      const responseText = await readResponseText();
      let details: unknown = responseText;
      if (responseText && responseText.trim()) {
        try {
          details = JSON.parse(responseText);
        } catch {
          details = responseText;
        }
      }
      throw new ApiError(`Novel API request failed: ${response.status}`, response.status, details);
    }

    const parsed =
      shouldEagerlyParse
        ? parseCareerSystemGenerationResponseText(await readResponseText())
        : {
          data: normalizeCareerSystemGenerationData(null),
          events: [],
        };
    return {
      ...parsed.data,
      events: parsed.events,
      rawResponse: response,
      body: response.body,
      ok: response.ok,
      status: response.status,
    };
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

  async generateInspirationOptions(
    step: string,
    context: Record<string, unknown>,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<InspirationOption> {
    const raw = await request<unknown>('/inspiration/generate-options', {
      method: 'POST',
      body: { step, context, ...(modelRouting ?? {}) },
    });
    if (!isRecord(raw)) return { prompt: '', options: [] };
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      options: Array.isArray(raw.options) ? raw.options as string[] : [],
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async refineInspirationOptions(
    step: string,
    context: Record<string, unknown>,
    feedback: string,
    previousOptions: string[],
    modelRouting?: AiModelRoutingPayload,
  ): Promise<InspirationOption> {
    const raw = await request<unknown>('/inspiration/refine-options', {
      method: 'POST',
      body: { step, context, feedback, previous_options: previousOptions, ...(modelRouting ?? {}) },
    });
    if (!isRecord(raw)) return { prompt: '', options: [] };
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      options: Array.isArray(raw.options) ? raw.options as string[] : [],
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async quickGenerateInspiration(
    params: Record<string, unknown>,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<InspirationOption> {
    const raw = await request<unknown>('/inspiration/quick-generate', {
      method: 'POST',
      body: { ...params, ...(modelRouting ?? {}) },
    });
    if (!isRecord(raw)) return { prompt: '', options: [] };
    return {
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      options: Array.isArray(raw.options) ? raw.options as string[] : [],
      error: typeof raw.error === 'string' ? raw.error : undefined,
    };
  }

  async createBookImportTask(
    file: File,
    params: { extractMode: string; tailChapterCount: number },
    modelRouting?: AiModelRoutingPayload,
  ): Promise<{ taskId: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('extract_mode', normalizeBookImportExtractMode(params.extractMode));
    formData.append('tail_chapter_count', String(params.tailChapterCount));
    if (modelRouting?.module_id) {
      formData.append('module_id', modelRouting.module_id);
    }
    if (modelRouting?.ai_provider_id) {
      formData.append('ai_provider_id', modelRouting.ai_provider_id);
    }
    if (modelRouting?.ai_model) {
      formData.append('ai_model', modelRouting.ai_model);
    }

    const response = await fetch(buildBookImportUrl('/tasks'), {
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
    const raw = await requestBookImport<unknown>(`/tasks/${encodeURIComponent(taskId)}`);
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
    const raw = await requestBookImport<unknown>(`/tasks/${encodeURIComponent(taskId)}/preview`);
    return normalizeBookImportPreview(raw);
  }

  async applyBookImport(
    taskId: string,
    payload: Record<string, unknown>,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<unknown> {
    return requestBookImport(`/tasks/${encodeURIComponent(taskId)}/apply`, {
      method: 'POST',
      body: withModelRoutingBody(payload, modelRouting),
    });
  }

  async applyBookImportStream(
    taskId: string,
    payload: Record<string, unknown>,
    modelRouting?: AiModelRoutingPayload,
  ): Promise<Response> {
    const response = await fetch(buildBookImportUrl(`/tasks/${encodeURIComponent(taskId)}/apply-stream`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withModelRoutingBody(payload, modelRouting)),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new ApiError(
        `Book import stream request failed: ${response.status}`,
        response.status,
        parseJsonOrText(responseText),
      );
    }

    return response;
  }

  async cancelBookImportTask(taskId: string): Promise<void> {
    await requestBookImport(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  }

  async retryBookImportStepsStream(
    taskId: string,
    steps: string[],
    modelRouting?: AiModelRoutingPayload,
  ): Promise<Response> {
    const response = await fetch(buildBookImportUrl(`/tasks/${encodeURIComponent(taskId)}/retry-stream`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withModelRoutingBody({ steps }, modelRouting)),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new ApiError(
        `Book import stream request failed: ${response.status}`,
        response.status,
        parseJsonOrText(responseText),
      );
    }

    return response;
  }
}

export const novelApiService = new NovelApiService();
