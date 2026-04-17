import { databaseService } from './database';
import { executeRemoteFirst, novelApiService } from './novel-api';
import type { Novel, Chapter, Character, Setting, Faction, Item, EntityRelationship, TimelineEvent, GraphLayout, Volume } from './schemas';
import { generateUniqueId, generateChapterId, generateCharacterId, generateSettingId } from './utils';

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
    );
  }

  async getAllNovels(): Promise<Array<{ id: number; title: string; outline?: string; coverImage?: string; volumesCount: number; chaptersCount: number; wordCount: number }>> {
    return executeRemoteFirst(
      () => novelApiService.getNovels() as Promise<Array<{ id: number; title: string; outline?: string; coverImage?: string; volumesCount: number; chaptersCount: number; wordCount: number }>>,
      () => databaseService.getAllNovels(),
      'NovelDomainService.getAllNovels',
    );
  }

  async saveNovel(novel: Novel): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.createNovel(novel).then(() => undefined),
      () => databaseService.saveNovel(novel),
      'NovelDomainService.saveNovel',
      () => databaseService.saveNovel(novel),
    );
  }

  async updateNovel(novelId: string | number, updates: Partial<Novel>): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateNovel(novelId, updates).then(() => undefined),
      () => databaseService.updateNovel(novelId, updates),
      'NovelDomainService.updateNovel',
      () => databaseService.updateNovel(novelId, updates),
    );
  }

  async deleteNovel(title: string): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.deleteNovel(title),
      () => databaseService.deleteNovel(title),
      'NovelDomainService.deleteNovel',
      () => databaseService.deleteNovel(title),
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
    );
    return chapter;
  }

  async updateChapter(chapter: Chapter): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateChapter(chapter.novelId, chapter.id, chapter).then(() => undefined),
      () => databaseService.updateChapter(chapter),
      'NovelDomainService.updateChapter',
      () => databaseService.updateChapter(chapter),
    );
  }

  async updateChapterContent(chapterId: string, content: string): Promise<void> {
    return databaseService.updateChapterContent(chapterId, content);
  }

  async deleteChapter(chapterId: string): Promise<void> {
    return databaseService.deleteChapter(chapterId);
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
    );
    return character;
  }

  async updateCharacter(character: Character): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateCharacter(character).then(() => undefined),
      () => databaseService.updateCharacter(character),
      'NovelDomainService.updateCharacter',
      () => databaseService.updateCharacter(character),
    );
  }

  async deleteCharacter(characterId: string): Promise<void> {
    return databaseService.deleteCharacter(characterId);
  }

  async createSetting(novelId: string, data: { name: string; description?: string; type?: '城市' | '建筑' | '自然景观' | '地区' | '其他' }): Promise<Setting> {
    const setting: Setting = {
      id: generateSettingId(),
      name: data.name,
      description: data.description,
      type: data.type ?? '其他',
      novelId,
    };
    await executeRemoteFirst(
      () => novelApiService.createSetting(novelId, setting).then(() => undefined),
      () => databaseService.addSetting(setting, novelId),
      'NovelDomainService.createSetting',
      () => databaseService.addSetting(setting, novelId),
    );
    return setting;
  }

  async updateSetting(setting: Setting): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateSetting(setting).then(() => undefined),
      () => databaseService.updateSetting(setting),
      'NovelDomainService.updateSetting',
      () => databaseService.updateSetting(setting),
    );
  }

  async deleteSetting(settingId: string): Promise<void> {
    return databaseService.deleteSetting(settingId);
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
    );
    return faction;
  }

  async updateFaction(faction: Faction): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateFaction(faction).then(() => undefined),
      () => databaseService.updateFaction(faction),
      'NovelDomainService.updateFaction',
      () => databaseService.updateFaction(faction),
    );
  }

  async deleteFaction(factionId: string): Promise<void> {
    return databaseService.deleteFaction(factionId);
  }

  async createItem(novelId: string, data: { name: string; description?: string; type?: '关键物品' | '武器' | '科技装置' | '普通物品' | '其他'; ownerId?: string }): Promise<Item> {
    const item: Item = {
      id: generateUniqueId('item'),
      name: data.name,
      description: data.description,
      type: data.type ?? '其他',
      ownerId: data.ownerId,
      novelId,
    };
    await executeRemoteFirst(
      () => novelApiService.createItem(novelId, item).then(() => undefined),
      () => databaseService.addItem(item, novelId),
      'NovelDomainService.createItem',
      () => databaseService.addItem(item, novelId),
    );
    return item;
  }

  async updateItem(item: Item): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateItem(item).then(() => undefined),
      () => databaseService.updateItem(item),
      'NovelDomainService.updateItem',
      () => databaseService.updateItem(item),
    );
  }

  async deleteItem(itemId: string): Promise<void> {
    return databaseService.deleteItem(itemId);
  }

  async createVolume(novelId: string, data: { title: string; description?: string; order?: number }): Promise<Volume> {
    const volume: Volume = {
      id: generateUniqueId('volume'),
      title: data.title,
      description: data.description,
      novelId,
      order: data.order ?? 0,
    };
    await databaseService.addVolume(volume, novelId);
    return volume;
  }

  async updateVolume(volume: Volume): Promise<void> {
    return databaseService.updateVolume(volume);
  }

  async deleteVolume(volumeId: string): Promise<void> {
    return databaseService.deleteVolume(volumeId);
  }

  async getTimelineEvents(novelId: string): Promise<TimelineEvent[]> {
    return executeRemoteFirst(
      () => novelApiService.getTimelineEvents(novelId),
      () => databaseService.getTimelineEvents(novelId),
      'NovelDomainService.getTimelineEvents',
      async (events) => {
        await Promise.all(events.map((event) => databaseService.updateTimelineEvent(event)));
      },
    );
  }

  async addTimelineEvent(novelId: string, event: Omit<TimelineEvent, 'id'>): Promise<void> {
    const timelineEvent = { ...event, id: generateUniqueId('timeline') } as TimelineEvent;
    return executeRemoteFirst(
      () => novelApiService.addTimelineEvent(novelId, timelineEvent).then(() => undefined),
      () => databaseService.addTimelineEvent(timelineEvent, novelId),
      'NovelDomainService.addTimelineEvent',
      () => databaseService.addTimelineEvent(timelineEvent, novelId),
    );
  }

  async updateTimelineEvent(event: TimelineEvent): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateTimelineEvent(event.novelId, event.id, event).then(() => undefined),
      () => databaseService.updateTimelineEvent(event),
      'NovelDomainService.updateTimelineEvent',
      () => databaseService.updateTimelineEvent(event),
    );
  }

  async deleteTimelineEvent(eventId: string): Promise<void> {
    return databaseService.deleteTimelineEvent(eventId);
  }

  async getRelationships(novelId?: string): Promise<EntityRelationship[]> {
    return databaseService.getAllRelationships(novelId);
  }

  async addRelationship(novelId: string, relationship: Omit<EntityRelationship, 'id'>): Promise<void> {
    return databaseService.addRelationship({ ...relationship, id: generateUniqueId('rel') } as EntityRelationship, novelId);
  }

  async deleteRelationship(relationshipId: string): Promise<void> {
    return databaseService.deleteRelationship(relationshipId);
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
    );
  }

  async saveGraphLayout(layout: GraphLayout): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.saveGraphLayout(layout).then(() => undefined),
      () => databaseService.saveGraphLayout(layout),
      'NovelDomainService.saveGraphLayout',
      () => databaseService.saveGraphLayout(layout),
    );
  }

  async updateNodePositions(novelId: string, positions: Record<string, { x: number; y: number; fx?: number; fy?: number }>): Promise<void> {
    return executeRemoteFirst(
      () => novelApiService.updateNodePositions(novelId, positions).then(() => undefined),
      () => databaseService.updateNodePositions(novelId, positions),
      'NovelDomainService.updateNodePositions',
      () => databaseService.updateNodePositions(novelId, positions),
    );
  }

  async getDashboardStats(): Promise<{ totalWordCount: number; totalChapters: number; totalEntities: number; novelCount: number }> {
    return databaseService.getDashboardStats();
  }

  async exportAllData(): Promise<any> {
    return databaseService.exportAllData();
  }

  async importData(data: any): Promise<void> {
    return databaseService.importData(data);
  }
}

export const novelDomainService = new NovelDomainService();
