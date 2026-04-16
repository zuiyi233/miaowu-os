/**
 * ContextEngineService 增强版功能测试
 *
 * 验证上下文感知 2.0 的核心功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contextEngineService } from '../services/contextEngineService';

// Mock 数据库服务
vi.mock('../lib/storage/db', () => ({
  databaseService: {
    loadNovel: vi.fn()
  }
}));

// Mock UI Store
vi.mock('../stores/useUiStore', () => ({
  useUiStore: {
    getState: vi.fn(() => ({
      currentNovelTitle: 'Test Novel'
    }))
  }
}));

// Mock 关系服务
vi.mock('../services/relationshipService', () => ({
  relationshipService: {
    getBacklinks: vi.fn()
  }
}));

// Mock 文本分析工具
vi.mock('../lib/utils/text-analysis', () => ({
  getPlainTextSnippet: vi.fn((html: string) => html.replace(/<[^>]*>/g, '').slice(0, 100))
}));

describe('ContextEngineService 增强版功能测试', () => {
  const mockNovel = {
    title: 'Test Novel',
    characters: [
      {
        id: 'char-1',
        name: '艾拉',
        description: '勇敢的战士',
        factionId: 'faction-1'
      },
      {
        id: 'char-2',
        name: '卡尔',
        description: '智慧的法师'
      }
    ],
    settings: [
      {
        id: 'setting-1',
        name: '迷雾镇',
        description: '被神秘雾气笼罩的小镇'
      }
    ],
    factions: [
      {
        id: 'faction-1',
        name: '铁锤兄弟会',
        description: '保护村庄的战士组织',
        leaderId: 'char-1'
      }
    ],
    items: [
      {
        id: 'item-1',
        name: '屠龙剑',
        description: '传说中的神剑',
        type: '武器',
        ownerId: 'char-1'
      }
    ],
    chapters: [
      {
        id: 'chapter-1',
        title: '第一章',
        content: '<p>这是关于<span data-type="mention" data-id="char-1">艾拉</span>的故事</p>'
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (databaseService.loadNovel as any).mockResolvedValue(mockNovel);
    (relationshipService.getBacklinks as any).mockReturnValue([]);
  });

  describe('智能实体解析功能', () => {
    it('应该解析语法标记和直接提及的实体', async () => {
      const userInput = '艾拉在迷雾镇与卡尔战斗，她使用了$屠龙剑$';
      const entities = await contextEngineService.intelligentEntityParsing(userInput);

      expect(entities.characters).toContain('艾拉');
      expect(entities.characters).toContain('卡尔');
      expect(entities.settings).toContain('迷雾镇');
      expect(entities.items).toContain('屠龙剑');
    });

    it('应该避免重复实体', async () => {
      const userInput = '@艾拉和艾拉一起冒险';
      const entities = await contextEngineService.intelligentEntityParsing(userInput);

      expect(entities.characters).toEqual(['艾拉']);
    });
  });

  describe('增强版上下文检索功能', () => {
    it('应该检索包含关系网的上下文数据', async () => {
      const entities = {
        characters: ['艾拉'],
        settings: [],
        factions: [],
        items: []
      };

      const contextData = await contextEngineService.retrieveEnhancedContext(entities);

      expect(contextData.nodes).toHaveLength(1);
      expect(contextData.nodes[0].name).toBe('艾拉');
      expect(contextData.nodes[0].type).toBe('character');
      expect(contextData.nodes[0].factionId).toBe('faction-1');
    });

    it('应该包含硬关联关系', async () => {
      const entities = {
        characters: ['艾拉'],
        settings: [],
        factions: [],
        items: []
      };

      const contextData = await contextEngineService.retrieveEnhancedContext(entities);

      // 应该包含角色与势力的关系
      const membershipEdge = contextData.edges.find(
        edge => edge.type === 'membership'
      );
      expect(membershipEdge).toBeDefined();
      expect(membershipEdge?.source).toBe('艾拉');
      expect(membershipEdge?.target).toBe('铁锤兄弟会');
    });

    it('应该包含反向链接关系', async () => {
      // Mock 反向链接
      (relationshipService.getBacklinks as any).mockReturnValue([
        {
          sourceId: 'chapter-1',
          sourceTitle: '第一章',
          sourceType: 'chapter'
        }
      ]);

      const entities = {
        characters: ['艾拉'],
        settings: [],
        factions: [],
        items: []
      };

      const contextData = await contextEngineService.retrieveEnhancedContext(entities);

      // 应该包含章节中的提及关系
      const mentionEdge = contextData.edges.find(
        edge => edge.type === 'mention'
      );
      expect(mentionEdge).toBeDefined();
      expect(mentionEdge?.source).toBe('艾拉');
      expect(mentionEdge?.target).toBe('第一章');
    });
  });

  describe('增强版上下文组装功能', () => {
    it('应该组装包含关系信息的上下文', () => {
      const contextData = {
        nodes: [
          {
            id: 'char-1',
            type: 'character' as const,
            name: '艾拉',
            description: '勇敢的战士',
            factionId: 'faction-1'
          }
        ],
        edges: [
          {
            source: '艾拉',
            target: '铁锤兄弟会',
            type: 'membership' as const,
            context: '角色所属势力'
          }
        ]
      };

      const context = contextEngineService.assembleEnhancedContext(contextData);

      expect(context).toContain('🌍 世界观上下文');
      expect(context).toContain('[角色] 艾拉: 勇敢的战士');
      expect(context).toContain('【潜在联系】');
      expect(context).toContain('艾拉 隶属于 铁锤兄弟会');
    });
  });

  describe('增强版提示词增强功能', () => {
    it('应该使用智能解析和关系感知增强提示词', async () => {
      const userInput = '艾拉在迷雾镇冒险';
      const enhancedPrompt = await contextEngineService.enhancePromptWithRelations(userInput);

      expect(enhancedPrompt).toContain('🌍 世界观上下文');
      expect(enhancedPrompt).toContain('艾拉');
      expect(enhancedPrompt).toContain('迷雾镇');
    });
  });

  describe('向后兼容性', () => {
    it('原有的enhancePrompt方法应该正常工作', async () => {
      const userInput = '@艾拉在#迷雾镇冒险';
      const enhancedPrompt = await contextEngineService.enhancePrompt(userInput);

      expect(enhancedPrompt).toContain('上下文开始');
      expect(enhancedPrompt).toContain('[角色]');
      expect(enhancedPrompt).toContain('[场景]');
    });

    it('原有的checkConsistency方法应该支持物品', async () => {
      const entities = {
        characters: ['艾拉'],
        settings: [],
        factions: [],
        items: ['屠龙剑']
      };

      const result = await contextEngineService.checkConsistency('艾拉拿到了屠龙剑', entities);

      expect(result.isConsistent).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});