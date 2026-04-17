import Dexie, { type Table } from 'dexie';

import type {
  Novel,
  Chapter,
  Character,
  Setting,
  Volume,
  Faction,
  Item,
  PromptTemplate,
  EntityRelationship,
  TimelineEvent,
  GraphLayout,
  ChatSession,
  AnnotationThread,
  RecommendationItem,
} from './schemas';
import { generateUniqueId } from './utils/id';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  action: 'create' | 'update' | 'delete' | 'restore' | 'export' | 'import';
  entityType: 'novel' | 'chapter' | 'character' | 'setting' | 'timeline' | 'relationship' | 'template';
  entityId: string;
  entityName: string;
  details: string;
  author: string;
  reason?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
}

export interface ChapterSnapshot {
  id?: number;
  chapterId: string;
  content: string;
  timestamp: Date;
  description?: string;
  version?: number;
  workflowState?: string;
  author?: string;
  changeReason?: string;
}

export class NovelDB extends Dexie {
  novels!: Table<Novel & { id?: number }>;
  volumes!: Table<Volume>;
  chapters!: Table<Chapter>;
  characters!: Table<Character>;
  settings!: Table<Setting>;
  factions!: Table<Faction>;
  items!: Table<Item>;
  promptTemplates!: Table<PromptTemplate>;
  relationships!: Table<EntityRelationship>;
  timelineEvents!: Table<TimelineEvent>;
  graphLayouts!: Table<GraphLayout>;
  snapshots!: Table<ChapterSnapshot>;
  chatSessions!: Table<ChatSession>;
  annotationThreads!: Table<AnnotationThread>;
  recommendationItems!: Table<RecommendationItem>;
  auditLog!: Table<AuditEntry>;

  constructor() {
    super('DeerFlowNovelistDB');

    this.version(1).stores({
      novels: '++id, title',
      volumes: 'id, novelId',
      chapters: 'id, novelId, volumeId',
      characters: 'id, novelId, factionId',
      settings: 'id, novelId',
      factions: 'id, novelId',
      items: 'id, novelId, ownerId',
      promptTemplates: 'id, type, isActive',
      relationships: 'id, sourceId, targetId, type, novelId',
      timelineEvents: 'id, novelId, sortValue, type, *relatedEntityIds',
      graphLayouts: 'id, novelId, lastUpdated',
      snapshots: '++id, chapterId, timestamp',
      chatSessions: 'id, novelId, updatedAt',
    });

    this.version(2)
      .stores({
        novels: '++id, title, id, syncStatus, workflowState',
        volumes: 'id, novelId, syncStatus, workflowState',
        chapters: 'id, novelId, volumeId, syncStatus, workflowState',
        characters: 'id, novelId, factionId, syncStatus, workflowState',
        settings: 'id, novelId, syncStatus, workflowState',
        factions: 'id, novelId, syncStatus, workflowState',
        items: 'id, novelId, ownerId, syncStatus, workflowState',
        promptTemplates: 'id, type, isActive, version, scope, novelId, syncStatus',
        relationships: 'id, sourceId, targetId, type, novelId, syncStatus',
        timelineEvents: 'id, novelId, sortValue, type, *relatedEntityIds, syncStatus, workflowState',
        graphLayouts: 'id, novelId, lastUpdated, syncStatus',
        snapshots: '++id, chapterId, timestamp, version, workflowState',
        chatSessions: 'id, novelId, updatedAt',
        annotationThreads: 'id, novelId, chapterId, type, status',
        recommendationItems: 'id, novelId, type, priority, status',
        auditLog: 'id, timestamp, action, entityType, entityId, author',
      })
      .upgrade(async (tx) => {
        await tx.table('novels').toCollection().modify((novel: any) => {
          if (!novel.id) novel.id = `novel-${crypto.randomUUID().slice(0, 12)}`;
          if (!novel.syncStatus) novel.syncStatus = 'local';
          if (!novel.version) novel.version = 1;
          if (!novel.workflowState) novel.workflowState = 'draft';
          if (!novel.createdAt) novel.createdAt = new Date().toISOString();
          if (!novel.updatedAt) novel.updatedAt = new Date().toISOString();
        });

        const tablesToMigrate = ['volumes', 'chapters', 'characters', 'settings', 'factions', 'items', 'relationships', 'timelineEvents'];
        for (const tableName of tablesToMigrate) {
          await tx.table(tableName).toCollection().modify((item: any) => {
            if (!item.syncStatus) item.syncStatus = 'local';
            if (!item.version) item.version = 1;
            if (!item.workflowState) item.workflowState = 'draft';
            if (!item.createdAt) item.createdAt = new Date().toISOString();
            if (!item.updatedAt) item.updatedAt = new Date().toISOString();
          });
        }

        await tx.table('snapshots').toCollection().modify((snapshot: any) => {
          if (!snapshot.version) snapshot.version = 1;
          if (!snapshot.workflowState) snapshot.workflowState = 'draft';
        });

        await tx.table('promptTemplates').toCollection().modify((template: any) => {
          if (!template.version) template.version = 1;
          if (!template.scope) template.scope = 'global';
          if (!template.syncStatus) template.syncStatus = 'local';
          if (!template.createdAt) template.createdAt = new Date().toISOString();
          if (!template.updatedAt) template.updatedAt = new Date().toISOString();
        });
      });
  }

  async createSnapshot(chapterId: string, content: string, description?: string): Promise<number> {
    return await this.snapshots.add({
      chapterId,
      content,
      timestamp: new Date(),
      description,
    });
  }

  async getChapterSnapshots(chapterId: string): Promise<ChapterSnapshot[]> {
    return await this.snapshots
      .where('chapterId')
      .equals(chapterId)
      .reverse()
      .sortBy('timestamp');
  }

  async getLatestSnapshot(chapterId: string): Promise<ChapterSnapshot | undefined> {
    return await this.snapshots.where('chapterId').equals(chapterId).reverse().first();
  }
}

export const db = new NovelDB();

export class DatabaseService {
  private db: NovelDB;

  constructor(database: NovelDB = db) {
    this.db = database;
  }

  async saveNovel(novel: Novel): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.novels, this.db.volumes, this.db.chapters, this.db.characters, this.db.settings, this.db.factions, this.db.items],
      async () => {
        const novelData: any = { ...novel };
        if (!novelData.id) novelData.id = generateUniqueId('novel');

        const existingNovel = await this.db.novels.where('id').equals(novelData.id).first()
          || await this.db.novels.where('title').equals(novel.title).first();
        if (existingNovel) {
          await this.db.novels.update(existingNovel.id, novelData);
        } else {
          await this.db.novels.put(novelData);
        }

        const novelKey = novelData.id;

        for (const volume of novel.volumes || []) {
          await this.db.volumes.put({ ...volume, novelId: novelKey } as any);
          for (const chapter of volume.chapters || []) {
            await this.db.chapters.put({ ...chapter, novelId: novelKey, volumeId: volume.id });
          }
        }

        for (const chapter of novel.chapters || []) {
          await this.db.chapters.put({ ...chapter, novelId: novelKey } as any);
        }

        for (const character of novel.characters || []) {
          await this.db.characters.put({ ...character, novelId: novelKey } as any);
        }

        for (const setting of novel.settings || []) {
          await this.db.settings.put({ ...setting, novelId: novelKey } as any);
        }

        for (const faction of novel.factions || []) {
          await this.db.factions.put({ ...faction, novelId: novelKey } as any);
        }

        for (const item of novel.items || []) {
          await this.db.items.put({ ...item, novelId: novelKey } as any);
        }

        for (const relationship of novel.relationships || []) {
          await this.db.relationships.put({ ...relationship, novelId: novelKey } as any);
        }
      }
    );
  }

  async loadNovel(novelIdOrTitle: string): Promise<Novel | null> {
    const novel = await this.db.novels.where('title').equals(novelIdOrTitle).first()
      || await this.db.novels.where('id').equals(novelIdOrTitle).first();
    if (!novel) return null;

    const resolvedNovelId = (novel as any).id || novel.title;

    const volumes = await this.db.volumes.where('novelId').equals(resolvedNovelId).toArray();
    const volumesWithChapters = await Promise.all(
      volumes.map(async (volume) => {
        const chapters = await this.db.chapters.where('volumeId').equals(volume.id).toArray();
        return { ...volume, chapters };
      })
    );

    const chapters = await this.db.chapters.where('novelId').equals(resolvedNovelId).toArray();
    const characters = await this.db.characters.where('novelId').equals(resolvedNovelId).toArray();
    const settings = await this.db.settings.where('novelId').equals(resolvedNovelId).toArray();
    const factions = await this.db.factions.where('novelId').equals(resolvedNovelId).toArray();
    const items = await this.db.items.where('novelId').equals(resolvedNovelId).toArray();
    const relationships = await this.db.relationships.where('novelId').equals(resolvedNovelId).toArray();

    return {
      ...novel,
      volumes: volumesWithChapters,
      chapters,
      characters,
      settings,
      factions,
      items,
      relationships,
    };
  }

  async updateNovel(novelId: string | number, updates: Partial<Novel>): Promise<void> {
    const key = typeof novelId === 'string' ? (novelId as any) : novelId;
    const existingNovel = await this.db.novels.get(key);
    if (!existingNovel) throw new Error(`Novel not found: ${novelId}`);
    const updatePayload: any = {
      ...updates,
      updatedAt: new Date().toISOString(),
      version: ((existingNovel as any)?.version || 0) + 1,
    };
    await this.db.novels.update(key, updatePayload);
  }

  async addCharacter(character: Character, novelId: string): Promise<void> {
    await this.db.characters.put({ ...character, novelId });
  }

  async updateCharacter(character: Character): Promise<void> {
    await this.db.characters.put(character);
  }

  async deleteCharacter(characterId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.characters, this.db.relationships, this.db.items, this.db.factions], async () => {
      await this.db.characters.delete(characterId);
      await this.db.relationships.where('sourceId').equals(characterId).or('targetId').equals(characterId).delete();
      await this.db.items.where('ownerId').equals(characterId).modify({ ownerId: '' });
      await this.db.factions.where('leaderId').equals(characterId).modify({ leaderId: '' });
    });
  }

  async addFaction(faction: Faction, novelId: string): Promise<void> {
    await this.db.factions.put({ ...faction, novelId });
  }

  async updateFaction(faction: Faction): Promise<void> {
    await this.db.factions.put(faction);
  }

  async deleteFaction(factionId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.factions, this.db.characters, this.db.relationships], async () => {
      await this.db.factions.delete(factionId);
      await this.db.characters.where('factionId').equals(factionId).modify({ factionId: '' });
      await this.db.relationships.where('sourceId').equals(factionId).or('targetId').equals(factionId).delete();
    });
  }

  async addSetting(setting: Setting, novelId: string): Promise<void> {
    await this.db.settings.put({ ...setting, novelId });
  }

  async updateSetting(setting: Setting): Promise<void> {
    await this.db.settings.put(setting);
  }

  async deleteSetting(settingId: string): Promise<void> {
    await this.db.settings.delete(settingId);
  }

  async addItem(item: Item, novelId: string): Promise<void> {
    await this.db.items.put({ ...item, novelId });
  }

  async updateItem(item: Item): Promise<void> {
    await this.db.items.put(item);
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.db.items.delete(itemId);
  }

  async addVolume(volume: Volume, novelId: string): Promise<void> {
    await this.db.volumes.put({ ...volume, novelId });
  }

  async updateVolume(volume: Volume): Promise<void> {
    await this.db.volumes.put(volume);
  }

  async deleteVolume(volumeId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.volumes, this.db.chapters], async () => {
      await this.db.volumes.delete(volumeId);
      await this.db.chapters.where('volumeId').equals(volumeId).delete();
    });
  }

  async addChapter(chapter: Chapter, novelId: string, volumeId?: string): Promise<void> {
    await this.db.chapters.put({ ...chapter, novelId, volumeId });
  }

  async updateChapterContent(chapterId: string, content: string): Promise<void> {
    await this.db.chapters.update(chapterId, { content });
  }

  async updateChapter(chapter: Chapter): Promise<void> {
    await this.db.chapters.put(chapter);
  }

  async deleteChapter(chapterId: string): Promise<void> {
    await this.db.chapters.delete(chapterId);
  }

  async addPromptTemplate(template: PromptTemplate): Promise<void> {
    await this.db.promptTemplates.put(template);
  }

  async updatePromptTemplate(template: PromptTemplate): Promise<void> {
    await this.db.promptTemplates.put(template);
  }

  async deletePromptTemplate(templateId: string): Promise<void> {
    await this.db.promptTemplates.delete(templateId);
  }

  async setActivePromptTemplate(id: string, type: string): Promise<void> {
    await this.db.transaction('rw', this.db.promptTemplates, async () => {
      await this.db.promptTemplates.where('type').equals(type).modify({ isActive: false });
      await this.db.promptTemplates.update(id, { isActive: true });
    });
  }

  async getActivePromptTemplate(type: string): Promise<PromptTemplate | null> {
    const result = await this.db.promptTemplates.where('type').equals(type).filter((p) => p.isActive === true).first();
    return result || null;
  }

  async getPromptTemplatesByType(type: string): Promise<PromptTemplate[]> {
    return await this.db.promptTemplates.where('type').equals(type).toArray();
  }

  async getAllPromptTemplates(): Promise<PromptTemplate[]> {
    return await this.db.promptTemplates.toArray();
  }

  async addRelationship(relationship: EntityRelationship, novelId: string): Promise<void> {
    await this.db.relationships.put({ ...relationship, novelId });
  }

  async updateRelationship(relationship: EntityRelationship): Promise<void> {
    await this.db.relationships.put(relationship);
  }

  async deleteRelationship(relationshipId: string): Promise<void> {
    await this.db.relationships.delete(relationshipId);
  }

  async getRelationshipsByEntity(entityId: string): Promise<EntityRelationship[]> {
    return await this.db.relationships.where('sourceId').equals(entityId).or('targetId').equals(entityId).toArray();
  }

  async getAllRelationships(novelId?: string): Promise<EntityRelationship[]> {
    if (novelId) {
      return await this.db.relationships.where('novelId').equals(novelId).toArray();
    }
    return await this.db.relationships.toArray();
  }

  async addTimelineEvent(event: TimelineEvent, novelId: string): Promise<void> {
    await this.db.timelineEvents.put({ ...event, novelId });
  }

  async updateTimelineEvent(event: TimelineEvent): Promise<void> {
    await this.db.timelineEvents.put(event);
  }

  async deleteTimelineEvent(eventId: string): Promise<void> {
    await this.db.timelineEvents.delete(eventId);
  }

  async getTimelineEvents(novelId: string): Promise<TimelineEvent[]> {
    return await this.db.timelineEvents.where('novelId').equals(novelId).sortBy('sortValue');
  }

  async saveGraphLayout(layout: GraphLayout): Promise<void> {
    await this.db.graphLayouts.put(layout);
  }

  async getGraphLayout(novelId: string): Promise<GraphLayout | null> {
    const layout = await this.db.graphLayouts.where('novelId').equals(novelId).first();
    return layout || null;
  }

  async updateNodePositions(
    novelId: string,
    positions: Record<string, { x: number; y: number; fx?: number; fy?: number }>
  ): Promise<void> {
    const layout = await this.getGraphLayout(novelId);
    if (!layout) {
      await this.saveGraphLayout({
        id: novelId,
        novelId,
        nodePositions: positions,
        isLocked: false,
        lastUpdated: new Date(),
      });
    } else {
      layout.nodePositions = { ...layout.nodePositions, ...positions };
      layout.lastUpdated = new Date();
      await this.saveGraphLayout(layout);
    }
  }

  async getAllNovels(): Promise<Array<{ id: number; title: string; outline?: string; coverImage?: string; volumesCount: number; chaptersCount: number; wordCount: number }>> {
    const novels = await this.db.novels.toArray();
    return await Promise.all(
      novels.map(async (novel) => {
        const resolvedNovelId = (novel as any).id || novel.title;
        const chapters = await this.db.chapters.where('novelId').equals(resolvedNovelId).toArray();
        const volumesCount = await this.db.volumes.where('novelId').equals(resolvedNovelId).count();
        const wordCount = chapters.reduce((acc, ch) => {
          const text = ch.content?.replace(/<[^>]*>/g, '') || '';
          return acc + text.length;
        }, 0);
        return {
          id: novel.id ?? 0,
          title: novel.title,
          outline: novel.outline,
          coverImage: novel.coverImage,
          volumesCount,
          chaptersCount: chapters.length,
          wordCount,
        };
      })
    );
  }

  async getDashboardStats(): Promise<{ totalWordCount: number; totalChapters: number; totalEntities: number; novelCount: number }> {
    const allChapters = await this.db.chapters.toArray();
    const totalWordCount = allChapters.reduce((acc, ch) => {
      const text = ch.content?.replace(/<[^>]*>/g, '') || '';
      return acc + text.length;
    }, 0);

    const [charCount, settingCount, factionCount, itemCount] = await Promise.all([
      this.db.characters.count(),
      this.db.settings.count(),
      this.db.factions.count(),
      this.db.items.count(),
    ]);

    return {
      totalWordCount,
      totalChapters: allChapters.length,
      totalEntities: charCount + settingCount + factionCount + itemCount,
      novelCount: await this.db.novels.count(),
    };
  }

  async deleteNovel(novelTitle: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.novels, this.db.volumes, this.db.chapters, this.db.characters, this.db.settings, this.db.factions, this.db.items, this.db.relationships, this.db.timelineEvents, this.db.graphLayouts],
      async () => {
        const novel = await this.db.novels.where('title').equals(novelTitle).first()
          || await this.db.novels.where('id').equals(novelTitle).first();
        if (!novel) return;
        const novelKey = (novel as any).id || novel.title;
        await this.db.volumes.where('novelId').equals(novelKey).delete();
        await this.db.chapters.where('novelId').equals(novelKey).delete();
        await this.db.characters.where('novelId').equals(novelKey).delete();
        await this.db.settings.where('novelId').equals(novelKey).delete();
        await this.db.factions.where('novelId').equals(novelKey).delete();
        await this.db.items.where('novelId').equals(novelKey).delete();
        await this.db.relationships.where('novelId').equals(novelKey).delete();
        await this.db.timelineEvents.where('novelId').equals(novelKey).delete();
        await this.db.graphLayouts.where('novelId').equals(novelKey).delete();
        await this.db.novels.where('title').equals(novel.title).delete();
      }
    );
  }

  async exportAllData(): Promise<{ version: number; novels: Novel[]; promptTemplates: PromptTemplate[]; timelineEvents: TimelineEvent[]; relationships: EntityRelationship[]; items: Item[]; graphLayouts: GraphLayout[] }> {
    const novels = await this.db.novels.toArray();
    const fullNovelsData = (await Promise.all(novels.map((novel) => this.loadNovel(novel.title)))).filter(Boolean) as Novel[];
    const promptTemplates = await this.db.promptTemplates.toArray();
    const timelineEvents = await this.db.timelineEvents.toArray();
    const relationships = await this.db.relationships.toArray();
    const items = await this.db.items.toArray();
    const graphLayouts = await this.db.graphLayouts.toArray();

    return {
      version: 1,
      novels: fullNovelsData,
      promptTemplates,
      timelineEvents,
      relationships,
      items,
      graphLayouts,
    };
  }

  async importData(data: any): Promise<void> {
    if (data.novels) {
      for (const novel of data.novels) {
        await this.saveNovel(novel);
      }
    }
    if (data.promptTemplates) await this.db.promptTemplates.bulkPut(data.promptTemplates);
    if (data.timelineEvents) await this.db.timelineEvents.bulkPut(data.timelineEvents);
    if (data.relationships) await this.db.relationships.bulkPut(data.relationships);
    if (data.items) await this.db.items.bulkPut(data.items);
    if (data.graphLayouts) await this.db.graphLayouts.bulkPut(data.graphLayouts);
  }

  async clearAllData(): Promise<void> {
    await Promise.all([
      this.db.novels.clear(),
      this.db.volumes.clear(),
      this.db.chapters.clear(),
      this.db.characters.clear(),
      this.db.settings.clear(),
      this.db.factions.clear(),
      this.db.items.clear(),
      this.db.promptTemplates.clear(),
      this.db.relationships.clear(),
      this.db.timelineEvents.clear(),
      this.db.graphLayouts.clear(),
      this.db.snapshots.clear(),
    ]);
  }

  async createChatSession(session: ChatSession): Promise<void> {
    await this.db.chatSessions.put(session);
  }

  async updateChatSession(session: ChatSession): Promise<void> {
    await this.db.chatSessions.put(session);
  }

  async deleteChatSession(id: string): Promise<void> {
    await this.db.chatSessions.delete(id);
  }

  async getChatSessions(novelId?: string): Promise<ChatSession[]> {
    if (novelId) {
      return await this.db.chatSessions.where('novelId').equals(novelId).reverse().sortBy('updatedAt');
    }
    return await this.db.chatSessions.orderBy('updatedAt').reverse().toArray();
  }

  async getChatSession(id: string): Promise<ChatSession | undefined> {
    return await this.db.chatSessions.get(id);
  }

  async createSnapshot(chapterId: string, content: string, description?: string): Promise<number> {
    return await this.db.createSnapshot(chapterId, content, description);
  }

  async createVersionedSnapshot(
    chapterId: string,
    content: string,
    options?: { description?: string; version?: number; workflowState?: string; author?: string; changeReason?: string }
  ): Promise<number> {
    const snapshots = await this.getChapterSnapshots(chapterId);
    const nextVersion = options?.version ?? (snapshots.length > 0 ? Math.max(...snapshots.map((s) => s.version || 1)) + 1 : 1);

    return await this.db.snapshots.add({
      chapterId,
      content,
      timestamp: new Date(),
      description: options?.description,
      version: nextVersion,
      workflowState: options?.workflowState || 'draft',
      author: options?.author,
      changeReason: options?.changeReason,
    });
  }

  async getChapterSnapshots(chapterId: string): Promise<ChapterSnapshot[]> {
    return await this.db.getChapterSnapshots(chapterId);
  }

  async getLatestSnapshot(chapterId: string): Promise<ChapterSnapshot | undefined> {
    return await this.db.getLatestSnapshot(chapterId);
  }

  async getSnapshotByVersion(chapterId: string, version: number): Promise<ChapterSnapshot | undefined> {
    return await this.db.snapshots.where('chapterId').equals(chapterId).and((s) => s.version === version).first();
  }

  async getSnapshotsByWorkflowState(chapterId: string, workflowState: string): Promise<ChapterSnapshot[]> {
    return await this.db.snapshots.where('chapterId').equals(chapterId).and((s) => s.workflowState === workflowState).toArray();
  }

  async addAnnotationThread(thread: AnnotationThread): Promise<void> {
    await this.db.annotationThreads.put(thread);
  }

  async updateAnnotationThread(thread: AnnotationThread): Promise<void> {
    await this.db.annotationThreads.put(thread);
  }

  async deleteAnnotationThread(id: string): Promise<void> {
    await this.db.annotationThreads.delete(id);
  }

  async getAnnotationThreads(novelId: string, chapterId?: string): Promise<AnnotationThread[]> {
    if (chapterId) {
      return await this.db.annotationThreads.where('novelId').equals(novelId).and((t) => t.chapterId === chapterId).toArray();
    }
    return await this.db.annotationThreads.where('novelId').equals(novelId).toArray();
  }

  async getAnnotationThreadsByStatus(novelId: string, status: string): Promise<AnnotationThread[]> {
    return await this.db.annotationThreads.where('novelId').equals(novelId).and((t) => t.status === status).toArray();
  }

  async addRecommendationItem(item: RecommendationItem): Promise<void> {
    await this.db.recommendationItems.put(item);
  }

  async updateRecommendationItem(item: RecommendationItem): Promise<void> {
    await this.db.recommendationItems.put(item);
  }

  async deleteRecommendationItem(id: string): Promise<void> {
    await this.db.recommendationItems.delete(id);
  }

  async getRecommendationItems(novelId: string, status?: string): Promise<RecommendationItem[]> {
    if (status) {
      return await this.db.recommendationItems.where('novelId').equals(novelId).and((r) => r.status === status).toArray();
    }
    return await this.db.recommendationItems.where('novelId').equals(novelId).toArray();
  }

  async getRecommendationItemsByType(novelId: string, type: string): Promise<RecommendationItem[]> {
    return await this.db.recommendationItems.where('novelId').equals(novelId).and((r) => r.type === type).toArray();
  }

  async addAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    await this.db.auditLog.add({
      ...entry,
      id: `audit-${crypto.randomUUID().slice(0, 12)}`,
      timestamp: new Date(),
    });
  }

  async getAuditEntries(limit?: number): Promise<AuditEntry[]> {
    const query = this.db.auditLog.orderBy('timestamp').reverse();
    if (limit) {
      return await query.limit(limit).toArray();
    }
    return await query.toArray();
  }

  async getAuditEntriesByEntityType(entityType: string, limit?: number): Promise<AuditEntry[]> {
    const query = this.db.auditLog.where('entityType').equals(entityType).reverse();
    if (limit) {
      return await query.limit(limit).toArray();
    }
    return await query.toArray();
  }

  async getAuditEntriesByEntityId(entityId: string): Promise<AuditEntry[]> {
    return await this.db.auditLog.where('entityId').equals(entityId).reverse().toArray();
  }

  async getAuditEntriesByAuthor(author: string): Promise<AuditEntry[]> {
    return await this.db.auditLog.where('author').equals(author).reverse().toArray();
  }

  async clearAuditLog(): Promise<void> {
    await this.db.auditLog.clear();
  }
}

export const databaseService = new DatabaseService();
