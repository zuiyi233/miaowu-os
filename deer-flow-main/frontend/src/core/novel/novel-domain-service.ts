import { DEFAULT_ITEM_TYPE, DEFAULT_SETTING_TYPE, type ItemType, type SettingType } from './constants';
import { databaseService } from './database';
import { executeRemoteFirst, novelApiService } from './novel-api';
import type { FallbackMode } from './novel-api';
import type { Novel, Chapter, Character, Setting, Faction, Item, EntityRelationship, TimelineEvent, GraphLayout, Volume } from './schemas';
import { generateUniqueId, generateChapterId, generateCharacterId, generateSettingId } from './utils';

const WRITE: FallbackMode = 'write';
const READ: FallbackMode = 'read';

export class NovelDomainService {
  async loadNovel(title: string): Promise<Novel | null> {
    return executeRemoteFirst(
      () => novelApiService.getNovelByIdOrTitle(title),
      () => databaseService.loadNovel(title),
      'NovelDomainService.loadNovel',
      async (novel) => {
        if (novel) {
          await databaseService.saveNovel(novel);
        }
      },
      READ,
    );
  }

  async getAllNovels(): Promise<Array<{ id: number; title: string; outline?: string; coverImage?: string; volumesCount: number; chaptersCount: number; wordCount: number }>> {
    return executeRemoteFirst(
      () => novelApiService.getNovels() as Promise<Array<{ id: number; title: string; outline?: string; coverImage?: string; volumesCount: number; chaptersCount: number; wordCount: number }>>,
      () => databaseService.getAllNovels(),
      'NovelDomainService.getAllNovels',
      undefined,
      READ,
    );
  }

  async saveNovel(novel: Novel): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.createNovel(novel).then(() => undefined),
      () => databaseService.saveNovel(novel),
      'NovelDomainService.saveNovel',
      () => databaseService.saveNovel(novel),
      WRITE,
    );
  }

  async updateNovel(novelId: string | number, updates: Partial<Novel>): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateNovel(novelId, updates).then(() => undefined),
      () => databaseService.updateNovel(novelId, updates),
      'NovelDomainService.updateNovel',
      () => databaseService.updateNovel(novelId, updates),
      WRITE,
    );
  }

  async deleteNovel(title: string): Promise<boolean> {
    return executeRemoteFirst(
      () => novelApiService.deleteNovel(title),
      () => databaseService.deleteNovel(title),
      'NovelDomainService.deleteNovel',
      async () => { await databaseService.deleteNovel(title); },
      WRITE,
    );
  }

  async createChapter(novelId: string, data: { title: string; content?: string; volumeId?: string; order?: number }): Promise<Chapter> {
    const chapter: Chapter = {
      id: generateChapterId(),
      title: data.title,
      content: data.content || '',
      volumeId: data.volumeId,
      novelId,
      order: data.order ?? 0,
    };
    await executeRemoteFirst(
      () => novelApiService.createChapter(novelId, chapter).then(() => undefined),
      () => databaseService.addChapter(chapter, novelId, data.volumeId),
      'NovelDomainService.createChapter',
      () => databaseService.addChapter(chapter, novelId, data.volumeId),
      WRITE,
    );
    return chapter;
  }

  async updateChapter(chapter: Chapter): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateChapter(chapter.novelId, chapter.id, chapter).then(() => undefined),
      () => databaseService.updateChapter(chapter),
      'NovelDomainService.updateChapter',
      () => databaseService.updateChapter(chapter),
      WRITE,
    );
  }

  async updateChapterContent(novelId: string, chapterId: string, content: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateChapter(novelId, chapterId, { content }).then(() => undefined),
      () => databaseService.updateChapterContent(chapterId, content),
      'NovelDomainService.updateChapterContent',
      () => databaseService.updateChapterContent(chapterId, content),
      WRITE,
    );
  }

  async deleteChapter(novelId: string, chapterId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteChapter(novelId, chapterId),
      () => databaseService.deleteChapter(chapterId),
      'NovelDomainService.deleteChapter',
      () => databaseService.deleteChapter(chapterId),
      WRITE,
    );
  }

  async createCharacter(novelId: string, data: { name: string; description?: string; factionId?: string }): Promise<Character> {
    const character: Character = {
      id: generateCharacterId(),
      name: data.name,
      description: data.description,
      factionId: data.factionId,
      novelId,
    };
    await executeRemoteFirst(
      () => novelApiService.createCharacter(novelId, character).then(() => undefined),
      () => databaseService.addCharacter(character, novelId),
      'NovelDomainService.createCharacter',
      () => databaseService.addCharacter(character, novelId),
      WRITE,
    );
    return character;
  }

  async updateCharacter(character: Character): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateCharacter(character).then(() => undefined),
      () => databaseService.updateCharacter(character),
      'NovelDomainService.updateCharacter',
      () => databaseService.updateCharacter(character),
      WRITE,
    );
  }

  async deleteCharacter(novelId: string, characterId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteCharacter(novelId, characterId),
      () => databaseService.deleteCharacter(characterId),
      'NovelDomainService.deleteCharacter',
      () => databaseService.deleteCharacter(characterId),
      WRITE,
    );
  }

  async createSetting(novelId: string, data: { name: string; description?: string; type?: SettingType }): Promise<Setting> {
    const setting: Setting = {
      id: generateSettingId(),
      name: data.name,
      description: data.description,
      type: data.type ?? DEFAULT_SETTING_TYPE,
      novelId,
    };
    await executeRemoteFirst(
      () => novelApiService.createSetting(novelId, setting).then(() => undefined),
      () => databaseService.addSetting(setting, novelId),
      'NovelDomainService.createSetting',
      () => databaseService.addSetting(setting, novelId),
      WRITE,
    );
    return setting;
  }

  async updateSetting(setting: Setting): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateSetting(setting).then(() => undefined),
      () => databaseService.updateSetting(setting),
      'NovelDomainService.updateSetting',
      () => databaseService.updateSetting(setting),
      WRITE,
    );
  }

  async deleteSetting(novelId: string, settingId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteSetting(novelId, settingId),
      () => databaseService.deleteSetting(settingId),
      'NovelDomainService.deleteSetting',
      () => databaseService.deleteSetting(settingId),
      WRITE,
    );
  }

  async createFaction(novelId: string, data: { name: string; description?: string; leaderId?: string }): Promise<Faction> {
    const faction: Faction = {
      id: generateUniqueId('faction'),
      name: data.name,
      description: data.description,
      leaderId: data.leaderId,
      novelId,
    };
    await executeRemoteFirst(
      () => novelApiService.createFaction(novelId, faction).then(() => undefined),
      () => databaseService.addFaction(faction, novelId),
      'NovelDomainService.createFaction',
      () => databaseService.addFaction(faction, novelId),
      WRITE,
    );
    return faction;
  }

  async updateFaction(faction: Faction): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateFaction(faction).then(() => undefined),
      () => databaseService.updateFaction(faction),
      'NovelDomainService.updateFaction',
      () => databaseService.updateFaction(faction),
      WRITE,
    );
  }

  async deleteFaction(novelId: string, factionId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteFaction(novelId, factionId),
      () => databaseService.deleteFaction(factionId),
      'NovelDomainService.deleteFaction',
      () => databaseService.deleteFaction(factionId),
      WRITE,
    );
  }

  async createItem(novelId: string, data: { name: string; description?: string; type?: ItemType; ownerId?: string }): Promise<Item> {
    const item: Item = {
      id: generateUniqueId('item'),
      name: data.name,
      description: data.description,
      type: data.type ?? DEFAULT_ITEM_TYPE,
      ownerId: data.ownerId,
      novelId,
    };
    await executeRemoteFirst(
      () => novelApiService.createItem(novelId, item).then(() => undefined),
      () => databaseService.addItem(item, novelId),
      'NovelDomainService.createItem',
      () => databaseService.addItem(item, novelId),
      WRITE,
    );
    return item;
  }

  async updateItem(item: Item): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateItem(item).then(() => undefined),
      () => databaseService.updateItem(item),
      'NovelDomainService.updateItem',
      () => databaseService.updateItem(item),
      WRITE,
    );
  }

  async deleteItem(novelId: string, itemId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteItem(novelId, itemId),
      () => databaseService.deleteItem(itemId),
      'NovelDomainService.deleteItem',
      () => databaseService.deleteItem(itemId),
      WRITE,
    );
  }

  async createVolume(novelId: string, data: { title: string; description?: string; order?: number }): Promise<Volume> {
    const volume: Volume = {
      id: generateUniqueId('volume'),
      title: data.title,
      description: data.description,
      novelId,
      order: data.order ?? 0,
    };
    return executeRemoteFirst(
      () => novelApiService.createVolume(novelId, data).then((v) => ({ ...volume, ...v })),
      () => databaseService.addVolume(volume, novelId).then(() => volume),
      'NovelDomainService.createVolume',
      () => databaseService.addVolume(volume, novelId),
      WRITE,
    );
  }

  async updateVolume(volume: Volume): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateVolume(volume.id, volume).then(() => undefined),
      () => databaseService.updateVolume(volume),
      'NovelDomainService.updateVolume',
      () => databaseService.updateVolume(volume),
      WRITE,
    );
  }

  async deleteVolume(novelId: string, volumeId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteVolume(volumeId),
      () => databaseService.deleteVolume(volumeId),
      'NovelDomainService.deleteVolume',
      () => databaseService.deleteVolume(volumeId),
      WRITE,
    );
  }

  async getTimelineEvents(novelId: string): Promise<TimelineEvent[]> {
    return executeRemoteFirst(
      () => novelApiService.getTimelineEvents(novelId),
      () => databaseService.getTimelineEvents(novelId),
      'NovelDomainService.getTimelineEvents',
      async (events) => {
        await Promise.all(events.map((event) => databaseService.updateTimelineEvent(event)));
      },
      READ,
    );
  }

  async addTimelineEvent(novelId: string, event: Omit<TimelineEvent, 'id'>): Promise<void> {
    const timelineEvent = { ...event, id: generateUniqueId('timeline') } as TimelineEvent;
    return executeRemoteFirst(
      () => novelApiService.addTimelineEvent(novelId, timelineEvent).then(() => undefined),
      () => databaseService.addTimelineEvent(timelineEvent, novelId),
      'NovelDomainService.addTimelineEvent',
      () => databaseService.addTimelineEvent(timelineEvent, novelId),
      WRITE,
    );
  }

  async updateTimelineEvent(event: TimelineEvent): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateTimelineEvent(event.novelId, event.id, event).then(() => undefined),
      () => databaseService.updateTimelineEvent(event),
      'NovelDomainService.updateTimelineEvent',
      () => databaseService.updateTimelineEvent(event),
      WRITE,
    );
  }

  async deleteTimelineEvent(novelId: string, eventId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteTimelineEvent(novelId, eventId),
      () => databaseService.deleteTimelineEvent(eventId),
      'NovelDomainService.deleteTimelineEvent',
      () => databaseService.deleteTimelineEvent(eventId),
      WRITE,
    );
  }

  async getRelationships(novelId?: string): Promise<EntityRelationship[]> {
    return executeRemoteFirst(
      () => novelApiService.getRelationships(novelId || ''),
      () => databaseService.getAllRelationships(novelId),
      'NovelDomainService.getRelationships',
      async (relationships) => {
        for (const rel of relationships) {
          await databaseService.addRelationship(rel, novelId || rel.novelId || '');
        }
      },
      READ,
    );
  }

  async addRelationship(novelId: string, relationship: Omit<EntityRelationship, 'id'>): Promise<void> {
    const rel = { ...relationship, id: generateUniqueId('rel') } as EntityRelationship;
    return executeRemoteFirst(
      () => novelApiService.createRelationship(novelId, relationship).then(() => undefined),
      () => databaseService.addRelationship(rel, novelId),
      'NovelDomainService.addRelationship',
      () => databaseService.addRelationship(rel, novelId),
      WRITE,
    );
  }

  async deleteRelationship(novelId: string, relationshipId: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteRelationship(relationshipId),
      () => databaseService.deleteRelationship(relationshipId),
      'NovelDomainService.deleteRelationship',
      () => databaseService.deleteRelationship(relationshipId),
      WRITE,
    );
  }

  async getGraphLayout(novelId: string): Promise<GraphLayout | null> {
    return executeRemoteFirst(
      () => novelApiService.getGraphLayout(novelId),
      () => databaseService.getGraphLayout(novelId),
      'NovelDomainService.getGraphLayout',
      (layout) => {
        if (layout) {
          return databaseService.saveGraphLayout(layout);
        }
      },
      READ,
    );
  }

  async saveGraphLayout(layout: GraphLayout): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.saveGraphLayout(layout).then(() => undefined),
      () => databaseService.saveGraphLayout(layout),
      'NovelDomainService.saveGraphLayout',
      () => databaseService.saveGraphLayout(layout),
      WRITE,
    );
  }

  async updateNodePositions(novelId: string, positions: Record<string, { x: number; y: number; fx?: number; fy?: number }>): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateNodePositions(novelId, positions).then(() => undefined),
      () => databaseService.updateNodePositions(novelId, positions),
      'NovelDomainService.updateNodePositions',
      () => databaseService.updateNodePositions(novelId, positions),
      WRITE,
    );
  }

  async getDashboardStats(): Promise<{ totalWordCount: number; totalChapters: number; totalEntities: number; novelCount: number }> {
    return novelApiService.getDashboardStats();
  }

  async exportAllData(): Promise<any> {
    const novels = await this.getAllNovels();
    return {
      version: 'backend-saas-export-v1',
      exportedAt: new Date().toISOString(),
      novels,
    };
  }

  async importData(data: any): Promise<void> {
    throw new Error('Legacy browser imports are disabled. Use the backend ZIP import flow so imported projects are stored in the unified database and object storage.');
  }
}

export const novelDomainService = new NovelDomainService();
