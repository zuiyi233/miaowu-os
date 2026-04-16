/**
 * 数据导出/导入功能测试
 *
 * 验证数据导出和导入功能的完整性，确保所有数据类型都能正确导出和导入
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService, db } from '../lib/storage/db';
import type { Novel, TimelineEvent, EntityRelationship, Item } from '../types';

describe('数据导出/导入功能测试', () => {
  let databaseService: DatabaseService;
  
  beforeEach(async () => {
    databaseService = new DatabaseService();
    // 清理所有数据以确保测试环境干净
    await databaseService.clearAllData();
  });

  afterEach(async () => {
    // 测试后清理数据
    await databaseService.clearAllData();
  });

  it('应该能够导出包含所有数据类型的完整备份', async () => {
    // 1. 创建测试数据
    const testNovel: Novel = {
      title: '测试小说',
      outline: '这是一个测试小说的大纲',
      volumes: [
        {
          id: 'vol1',
          title: '第一卷',
          description: '第一卷描述',
          chapters: [
            {
              id: 'ch1',
              title: '第一章',
              content: '<p>第一章内容</p>'
            }
          ]
        }
      ],
      chapters: [
        {
          id: 'ch1',
          title: '第一章',
          content: '<p>第一章内容</p>'
        }
      ],
      characters: [
        {
          id: 'char1',
          name: '测试角色',
          description: '这是一个测试角色'
        }
      ],
      settings: [
        {
          id: 'setting1',
          name: '测试场景',
          description: '这是一个测试场景',
          type: '城市'
        }
      ],
      factions: [
        {
          id: 'faction1',
          name: '测试势力',
          description: '这是一个测试势力'
        }
      ],
      items: [
        {
          id: 'item1',
          name: '测试物品',
          description: '这是一个测试物品',
          type: '关键物品'
        }
      ],
      relationships: [
        {
          id: 'rel1',
          sourceId: 'char1',
          targetId: 'faction1',
          type: '成员',
          description: '角色是势力的成员'
        }
      ]
    };

    // 2. 保存测试小说
    await databaseService.saveNovel(testNovel);

    // 3. 创建时间线事件
    const testTimelineEvent: TimelineEvent = {
      id: 'event1',
      novelId: '测试小说',
      title: '测试事件',
      description: '这是一个测试时间线事件',
      type: 'plot',
      sortValue: 1,
      relatedEntities: ['char1', 'setting1']
    };
    await databaseService.addTimelineEvent(testTimelineEvent, '测试小说');

    // 4. 导出所有数据
    const exportedData = await databaseService.exportAllData();

    // 5. 验证导出数据的完整性
    expect(exportedData.version).toBe(2);
    expect(exportedData.novels).toHaveLength(1);
    expect(exportedData.novels[0].title).toBe('测试小说');
    expect(exportedData.novels[0].characters).toHaveLength(1);
    expect(exportedData.novels[0].settings).toHaveLength(1);
    expect(exportedData.novels[0].factions).toHaveLength(1);
    expect(exportedData.novels[0].items).toHaveLength(1);
    expect(exportedData.novels[0].relationships).toHaveLength(1);
    
    // 验证独立导出的数据
    expect(exportedData.timelineEvents).toHaveLength(1);
    expect(exportedData.timelineEvents[0].title).toBe('测试事件');
    expect(exportedData.relationships).toHaveLength(1);
    expect(exportedData.relationships[0].type).toBe('成员');
    expect(exportedData.items).toHaveLength(1);
    expect(exportedData.items[0].name).toBe('测试物品');
    
    // 验证提示词模板（应该有默认模板）
    expect(exportedData.promptTemplates.length).toBeGreaterThan(0);
  });

  it('应该能够完整导入导出的数据', async () => {
    // 1. 创建并导出测试数据
    const testNovel: Novel = {
      title: '导入测试小说',
      outline: '这是一个导入测试小说的大纲',
      volumes: [
        {
          id: 'vol1',
          title: '第一卷',
          description: '第一卷描述',
          chapters: [
            {
              id: 'ch1',
              title: '第一章',
              content: '<p>第一章内容</p>'
            }
          ]
        }
      ],
      chapters: [
        {
          id: 'ch1',
          title: '第一章',
          content: '<p>第一章内容</p>'
        }
      ],
      characters: [
        {
          id: 'char1',
          name: '导入测试角色',
          description: '这是一个导入测试角色'
        }
      ],
      settings: [
        {
          id: 'setting1',
          name: '导入测试场景',
          description: '这是一个导入测试场景',
          type: '城市'
        }
      ],
      factions: [
        {
          id: 'faction1',
          name: '导入测试势力',
          description: '这是一个导入测试势力'
        }
      ],
      items: [
        {
          id: 'item1',
          name: '导入测试物品',
          description: '这是一个导入测试物品',
          type: '关键物品'
        }
      ],
      relationships: [
        {
          id: 'rel1',
          sourceId: 'char1',
          targetId: 'faction1',
          type: '成员',
          description: '角色是势力的成员'
        }
      ]
    };

    await databaseService.saveNovel(testNovel);

    const testTimelineEvent: TimelineEvent = {
      id: 'event1',
      novelId: '导入测试小说',
      title: '导入测试事件',
      description: '这是一个导入测试时间线事件',
      type: 'plot',
      sortValue: 1,
      relatedEntities: ['char1', 'setting1']
    };
    await databaseService.addTimelineEvent(testTimelineEvent, '导入测试小说');

    const exportedData = await databaseService.exportAllData();

    // 2. 清理数据库
    await databaseService.clearAllData();

    // 3. 导入数据
    await databaseService.importData(exportedData);

    // 4. 验证导入的数据完整性
    const importedNovel = await databaseService.loadNovel('导入测试小说');
    expect(importedNovel).not.toBeNull();
    expect(importedNovel!.title).toBe('导入测试小说');
    expect(importedNovel!.characters).toHaveLength(1);
    expect(importedNovel!.characters[0].name).toBe('导入测试角色');
    expect(importedNovel!.settings).toHaveLength(1);
    expect(importedNovel!.settings[0].name).toBe('导入测试场景');
    expect(importedNovel!.factions).toHaveLength(1);
    expect(importedNovel!.factions[0].name).toBe('导入测试势力');
    expect(importedNovel!.items).toHaveLength(1);
    expect(importedNovel!.items[0].name).toBe('导入测试物品');
    expect(importedNovel!.relationships).toHaveLength(1);
    expect(importedNovel!.relationships[0].type).toBe('成员');

    // 验证时间线事件
    const importedTimelineEvents = await databaseService.getTimelineEvents('导入测试小说');
    expect(importedTimelineEvents).toHaveLength(1);
    expect(importedTimelineEvents[0].title).toBe('导入测试事件');

    // 验证提示词模板
    const importedPromptTemplates = await databaseService.getAllPromptTemplates();
    expect(importedPromptTemplates.length).toBeGreaterThan(0);
  });

  it('应该能够处理部分数据导入', async () => {
    // 1. 创建部分数据
    const partialData = {
      version: 2,
      novels: [
        {
          title: '部分导入测试小说',
          outline: '这是一个部分导入测试小说的大纲',
          volumes: [],
          chapters: [],
          characters: [],
          settings: [],
          factions: [],
          items: [],
          relationships: []
        }
      ],
      promptTemplates: [],
      timelineEvents: [],
      relationships: [],
      items: []
    };

    // 2. 导入部分数据
    await databaseService.importData(partialData);

    // 3. 验证导入成功
    const importedNovel = await databaseService.loadNovel('部分导入测试小说');
    expect(importedNovel).not.toBeNull();
    expect(importedNovel!.title).toBe('部分导入测试小说');
  });

  it('应该能够处理空数据导入', async () => {
    // 1. 创建空数据
    const emptyData = {
      version: 2,
      novels: [],
      promptTemplates: [],
      timelineEvents: [],
      relationships: [],
      items: []
    };

    // 2. 导入空数据（不应该抛出错误）
    await expect(databaseService.importData(emptyData)).resolves.not.toThrow();
  });
});