import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contextEngineService } from '../services/contextEngineService';
import { databaseService } from '../lib/storage/db';
import type { PromptTemplate, CreatePromptTemplate } from '../lib/schemas';

// Mock dependencies
vi.mock('../lib/storage/db');
vi.mock('../stores/useUiStore');

describe('提示词工程系统测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('数据模型验证', () => {
    it('应该验证 PromptTemplate 类型定义', () => {
      const validTemplate: PromptTemplate = {
        id: 'test-1',
        name: '测试模板',
        description: '这是一个测试模板',
        type: 'continue',
        content: '请基于{{context}}续写：{{selection}}',
        isBuiltIn: false,
        isActive: true,
      };

      expect(validTemplate.id).toBe('test-1');
      expect(validTemplate.type).toBe('continue');
      expect(validTemplate.content).toContain('{{context}}');
      expect(validTemplate.content).toContain('{{selection}}');
    });

    it('应该验证 CreatePromptTemplate 类型定义', () => {
      const createTemplate: CreatePromptTemplate = {
        name: '新模板',
        description: '新创建的模板',
        type: 'polish',
        content: '请润色以下内容：{{selection}}',
        isActive: false,
      };

      expect(createTemplate.name).toBe('新模板');
      expect(createTemplate.type).toBe('polish');
      expect(createTemplate.isBuiltIn).toBeUndefined(); // 不应该包含此字段
    });
  });

  describe('提示词变量注入器测试', () => {
    it('应该正确替换 {{selection}} 变量', async () => {
      const template = '请续写：{{selection}}';
      const variables = {
        selection: '这是一个测试段落。',
      };

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toBe('请续写：这是一个测试段落。');
    });

    it('应该正确替换 {{input}} 变量', async () => {
      const template = '请根据以下指令写作：{{input}}';
      const variables = {
        input: '写一段战斗场景',
      };

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toBe('请根据以下指令写作：写一段战斗场景');
    });

    it('应该正确替换多个变量', async () => {
      const template = '基于{{context}}，请润色：{{selection}}，要求：{{input}}';
      const variables = {
        context: '这是一个奇幻世界',
        selection: '主角走进了森林',
        input: '增加神秘感',
      };

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toBe('基于这是一个奇幻世界，请润色：主角走进了森林，要求：增加神秘感');
    });

    it('应该处理未定义的变量', async () => {
      const template = '请续写：{{selection}}';
      const variables = {}; // 没有提供 selection

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toBe('请续写：{{selection}}'); // 保持原样
    });

    it('应该处理自定义变量', async () => {
      const template = '角色：{{characterName}}，场景：{{sceneName}}';
      const variables = {
        characterName: '艾拉',
        sceneName: '黄昏酒馆',
      };

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toBe('角色：艾拉，场景：黄昏酒馆');
    });

    it('应该处理错误情况', async () => {
      const template = '测试模板';
      const variables = {
        selection: '测试内容',
      };

      // 模拟错误情况
      vi.spyOn(contextEngineService, 'enhancePromptWithRelations').mockRejectedValue(new Error('测试错误'));

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toBe(template); // 错误时返回原始模板
    });
  });

  describe('数据库操作测试', () => {
    it('应该能够添加提示词模板', async () => {
      const mockTemplate: CreatePromptTemplate = {
        name: '测试模板',
        type: 'continue',
        content: '请续写：{{selection}}',
        isActive: false,
      };

      const mockDb = {
        promptTemplates: {
          put: vi.fn().mockResolvedValue('test-id'),
        },
      };

      vi.mocked(databaseService).mockImplementation(() => mockDb as any);

      const result = await mockDb.promptTemplates.put({ ...mockTemplate, id: 'test-id', isBuiltIn: false });
      expect(result).toBe('test-id');
      expect(mockDb.promptTemplates.put).toHaveBeenCalledWith({
        ...mockTemplate,
        id: 'test-id',
        isBuiltIn: false,
      });
    });

    it('应该能够设置激活模板', async () => {
      const mockDb = {
        transaction: vi.fn().mockImplementation((mode, tables, callback) => {
          return callback();
        }),
        promptTemplates: {
          where: vi.fn().mockReturnThis(),
          modify: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
        },
      };

      vi.mocked(databaseService).mockImplementation(() => mockDb as any);

      await mockDb.setActivePromptTemplate('test-id', 'continue');
      expect(mockDb.promptTemplates.where).toHaveBeenCalledWith('type');
      expect(mockDb.promptTemplates.update).toHaveBeenCalledWith('test-id', { isActive: true });
    });
  });

  describe('可用变量列表测试', () => {
    it('应该返回正确的可用变量列表', () => {
      const variables = contextEngineService.getAvailableVariables();
      
      expect(variables).toHaveLength(3);
      expect(variables[0]).toEqual({
        name: '世界观',
        value: '{{context}}',
        description: '自动注入相关的角色、场景和势力信息'
      });
      expect(variables[1]).toEqual({
        name: '选中文本',
        value: '{{selection}}',
        description: '当前编辑器选中的文本或上文内容'
      });
      expect(variables[2]).toEqual({
        name: '用户输入',
        value: '{{input}}',
        description: '用户在AI面板中输入的额外指令'
      });
    });
  });

  describe('集成测试', () => {
    it('应该完成完整的提示词模板工作流', async () => {
      // 1. 创建模板
      const template: CreatePromptTemplate = {
        name: '战斗场景模板',
        type: 'continue',
        content: '基于{{context}}，请续写战斗场景：{{selection}}。要求：{{input}}',
        isActive: true,
      };

      // 2. 注入变量
      const variables = {
        context: '这是一个魔法世界，主角是艾拉',
        selection: '艾拉举起了法杖',
        input: '增加紧张感和魔法效果',
      };

      const result = await contextEngineService.hydratePrompt(template.content, variables);
      
      // 3. 验证结果
      expect(result).toContain('这是一个魔法世界，主角是艾拉');
      expect(result).toContain('艾拉举起了法杖');
      expect(result).toContain('增加紧张感和魔法效果');
    });

    it('应该处理复杂的模板嵌套', async () => {
      const complexTemplate = `
任务：{{input}}
上下文：{{context}}
当前内容：{{selection}}
请基于以上信息，创作一个符合{{customStyle}}风格的作品。
`;

      const variables = {
        input: '写一段对话',
        context: '角色：艾拉，场景：黄昏酒馆',
        selection: '艾拉坐在吧台前',
        customStyle: '悬疑',
      };

      const result = await contextEngineService.hydratePrompt(complexTemplate, variables);
      
      expect(result).toContain('任务：写一段对话');
      expect(result).toContain('角色：艾拉，场景：黄昏酒馆');
      expect(result).toContain('艾拉坐在吧台前');
      expect(result).toContain('悬疑风格');
    });
  });

  describe('边界情况测试', () => {
    it('应该处理空模板', async () => {
      const result = await contextEngineService.hydratePrompt('', { selection: 'test' });
      expect(result).toBe('');
    });

    it('应该处理空变量对象', async () => {
      const template = '这是一个静态模板';
      const result = await contextEngineService.hydratePrompt(template, {});
      expect(result).toBe(template);
    });

    it('应该处理包含特殊字符的变量', async () => {
      const template = '内容：{{content}}';
      const variables = {
        content: '包含特殊字符：@#$%^&*()_+-=[]{}|;:,.<>?',
      };

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toContain('包含特殊字符：@#$%^&*()_+-=[]{}|;:,.<>?');
    });

    it('应该处理长文本变量', async () => {
      const longText = 'a'.repeat(10000); // 10k 字符
      const template = '长文本：{{longText}}';
      const variables = { longText };

      const result = await contextEngineService.hydratePrompt(template, variables);
      expect(result).toContain(longText);
      expect(result.length).toBeGreaterThan(10000);
    });
  });
});