import { describe, it, expect, beforeEach, vi } from 'vitest';
import { databaseService } from '../lib/storage/db';
import { contextEngineService } from '../services/contextEngineService';
import { 
  polishText, 
  expandText, 
  generateOutline, 
  continueWriting 
} from '../services/llmService';

// Mock dependencies
vi.mock('../lib/storage/db');
vi.mock('../services/contextEngineService');

describe('AI管道集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock successful API response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'Processed text' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "test"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      })
    });
  });

  describe('文本处理与模板集成', () => {
    it('应该使用激活的润色模板', async () => {
      // Arrange
      const mockTemplate = {
        id: 'test-polish',
        name: '测试润色',
        description: '测试模板',
        type: 'polish' as const,
        content: '润色以下内容：{{selection}}',
        isBuiltIn: false,
        isActive: true
      };
      (databaseService.getActivePromptTemplate as any).mockResolvedValue(mockTemplate);
      (contextEngineService.hydratePrompt as any).mockResolvedValue('润色以下内容：测试文本');

      // Act
      const result = await polishText('测试文本');

      // Assert
      expect(databaseService.getActivePromptTemplate).toHaveBeenCalledWith('polish');
      expect(contextEngineService.hydratePrompt).toHaveBeenCalledWith(
        mockTemplate.content,
        { selection: '测试文本' }
      );
      expect(result).toBe('Processed text');
    });

    it('应该使用激活的扩写模板', async () => {
      // Arrange
      const mockTemplate = {
        id: 'test-expand',
        name: '测试扩写',
        description: '测试模板',
        type: 'expand' as const,
        content: '扩写以下内容：{{selection}}',
        isBuiltIn: false,
        isActive: true
      };
      (databaseService.getActivePromptTemplate as any).mockResolvedValue(mockTemplate);
      (contextEngineService.hydratePrompt as any).mockResolvedValue('扩写以下内容：测试文本');

      // Act
      const result = await expandText('测试文本');

      // Assert
      expect(databaseService.getActivePromptTemplate).toHaveBeenCalledWith('expand');
      expect(contextEngineService.hydratePrompt).toHaveBeenCalledWith(
        mockTemplate.content,
        { selection: '测试文本' }
      );
      expect(result).toBe('Processed text');
    });
  });

  describe('大纲生成功能', () => {
    it('应该使用激活的大纲模板并返回JSON', async () => {
      // Arrange
      const mockTemplate = {
        id: 'test-outline',
        name: '测试大纲',
        description: '测试模板',
        type: 'outline' as const,
        content: '生成大纲：{{input}}',
        isBuiltIn: false,
        isActive: true
      };
      (databaseService.getActivePromptTemplate as any).mockResolvedValue(mockTemplate);
      (contextEngineService.hydratePrompt as any).mockResolvedValue('生成大纲：测试提示');

      // Mock JSON response for outline
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'ch1', title: '第一章' }]
      });

      // Act
      const result = await generateOutline('测试提示');

      // Assert
      expect(databaseService.getActivePromptTemplate).toHaveBeenCalledWith('outline');
      expect(contextEngineService.hydratePrompt).toHaveBeenCalledWith(
        mockTemplate.content,
        { input: '测试提示' }
      );
      expect(result).toEqual([{ id: 'ch1', title: '第一章' }]);
    });
  });

  describe('续写功能', () => {
    it('应该使用激活的续写模板并返回流', async () => {
      // Arrange
      const mockTemplate = {
        id: 'test-continue',
        name: '测试续写',
        description: '测试模板',
        type: 'continue' as const,
        content: '续写内容：{{selection}}',
        isBuiltIn: false,
        isActive: true
      };
      (databaseService.getActivePromptTemplate as any).mockResolvedValue(mockTemplate);
      (contextEngineService.hydratePrompt as any).mockResolvedValue('续写内容：前文内容');

      // Act
      const contentCallback = vi.fn();
      await continueWriting('前文内容', contentCallback);

      // Assert
      expect(databaseService.getActivePromptTemplate).toHaveBeenCalledWith('continue');
      expect(contextEngineService.hydratePrompt).toHaveBeenCalledWith(
        mockTemplate.content,
        { selection: '前文内容' }
      );
      expect(contentCallback).toHaveBeenCalled();
    });
  });

  describe('回退机制', () => {
    it('应该在没有激活模板时使用默认模板', async () => {
      // Arrange
      (databaseService.getActivePromptTemplate as any).mockResolvedValue(null);
      (contextEngineService.hydratePrompt as any).mockResolvedValue('请润色以下文本：测试文本');

      // Act
      const result = await polishText('测试文本');

      // Assert
      expect(contextEngineService.hydratePrompt).toHaveBeenCalledWith(
        '请润色以下文本：{{selection}}',
        { selection: '测试文本' }
      );
      expect(result).toBe('Processed text');
    });
  });
});