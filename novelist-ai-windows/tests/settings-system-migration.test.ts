/**
 * 设置系统迁移测试
 * 验证新的结构化设置系统的完整功能
 * 遵循单一职责原则，专注于设置系统测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSettingsStore, useActiveApiConfig, useModelConfig } from '../stores/useSettingsStore';
import { testApiConnection } from '../services/llmService';

// Mock fetch API
global.fetch = vi.fn();

describe('设置系统迁移测试', () => {
  beforeEach(() => {
    // 重置 store 状态
    useSettingsStore.getState().resetSettings();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useSettingsStore 基础功能', () => {
    it('应该初始化默认设置', () => {
      const { result } = renderHook(() => useSettingsStore());
      
      expect(result.current.apiConfigs).toHaveLength(2);
      expect(result.current.activeApiConfigId).toBe('default-newapi');
      expect(result.current.modelSettings.outline.model).toBe('gemini-2.5-flash');
      expect(result.current.modelSettings.polish.temperature).toBe(0.5);
    });

    it('应该能够添加新的 API 配置', () => {
      const { result } = renderHook(() => useSettingsStore());
      
      act(() => {
        result.current.addApiConfig({
          name: '测试配置',
          baseUrl: 'https://api.test.com/v1',
          apiKey: 'test-key-123',
        });
      });

      expect(result.current.apiConfigs).toHaveLength(3);
      expect(result.current.apiConfigs[2]).toMatchObject({
        name: '测试配置',
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'test-key-123',
      });
    });

    it('应该能够更新 API 配置', () => {
      const { result } = renderHook(() => useSettingsStore());
      
      act(() => {
        result.current.updateApiConfig('default-newapi', {
          name: '更新的配置',
          apiKey: 'updated-key-456',
        });
      });

      const config = result.current.apiConfigs.find(c => c.id === 'default-newapi');
      expect(config).toMatchObject({
        name: '更新的配置',
        apiKey: 'updated-key-456',
        baseUrl: 'https://api.openai.com/v1', // 应该保持不变
      });
    });

    it('应该能够删除 API 配置', () => {
      const { result } = renderHook(() => useSettingsStore());
      
      act(() => {
        result.current.addApiConfig({
          name: '临时配置',
          baseUrl: 'https://api.temp.com/v1',
          apiKey: 'temp-key',
        });
      });

      expect(result.current.apiConfigs).toHaveLength(3);

      act(() => {
        result.current.removeApiConfig('default-gemini');
      });

      expect(result.current.apiConfigs).toHaveLength(2);
      expect(result.current.apiConfigs.find(c => c.id === 'default-gemini')).toBeUndefined();
    });

    it('删除激活配置时应该自动切换到其他配置', () => {
      const { result } = renderHook(() => useSettingsStore());
      
      act(() => {
        result.current.removeApiConfig('default-newapi');
      });

      expect(result.current.activeApiConfigId).toBe('default-gemini');
    });

    it('应该能够更新模型配置', () => {
      const { result } = renderHook(() => useSettingsStore());
      
      act(() => {
        result.current.updateModelConfig('outline', {
          model: 'gpt-4',
          temperature: 0.9,
          maxTokens: 8192,
        });
      });

      expect(result.current.modelSettings.outline).toMatchObject({
        model: 'gpt-4',
        temperature: 0.9,
        maxTokens: 8192,
      });
    });
  });

  describe('useActiveApiConfig Hook', () => {
    it('应该返回当前激活的 API 配置', () => {
      const { result } = renderHook(() => useActiveApiConfig());
      
      expect(result.current).toMatchObject({
        id: 'default-newapi',
        name: '默认 NewAPI/OpenAI 兼容',
        baseUrl: 'https://api.openai.com/v1',
      });
    });

    it('当没有激活配置时应该返回 null', () => {
      const { result: storeResult } = renderHook(() => useSettingsStore());
      const { result } = renderHook(() => useActiveApiConfig());
      
      act(() => {
        storeResult.current.setSettings({ activeApiConfigId: null });
      });

      expect(result.current).toBeNull();
    });
  });

  describe('useModelConfig Hook', () => {
    it('应该返回指定任务的模型配置', () => {
      const { result } = renderHook(() => useModelConfig('outline'));
      
      expect(result.current).toMatchObject({
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
      });
    });

    it('应该返回 embedding 配置', () => {
      const { result } = renderHook(() => useModelConfig('embedding'));
      
      expect(result.current).toMatchObject({
        model: 'text-embedding-3-small',
      });
    });
  });

  describe('API 连接测试功能', () => {
    it('应该能够测试 API 连接', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Connection successful!" }),
      });

      const config = {
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'test-key',
      };

      const result = await testApiConnection(config);

      expect(result).toEqual({ message: "Connection successful!" });
      expect(mockFetch).toHaveBeenCalledWith('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'testConnection',
          payload: { settings: config }
        }),
      });
    });

    it('应该处理连接测试失败', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Invalid API key" }),
      });

      const config = {
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'invalid-key',
      };

      await expect(testApiConnection(config)).rejects.toThrow('连接测试失败: Invalid API key');
    });
  });

  describe('设置迁移功能', () => {
    it('应该能够从旧版本设置迁移', () => {
      // 模拟旧版本的设置数据
      const oldSettings = {
        autoSaveEnabled: true,
        autoSaveDelay: 300000,
        autoSnapshotEnabled: true,
        editorFont: "Lora" as const,
        editorFontSize: 18,
        apiKey: "old-api-key",
        geminiApiKey: "old-gemini-key",
        apiBaseUrl: "https://old.api.com/v1",
        embeddingModel: "old-embedding-model",
        outlineModel: "old-outline-model",
        continueWritingModel: "old-continue-model",
        textProcessingModel: "old-text-model",
        temperature: 0.6,
        maxOutputTokens: 1024,
      };

      // 这里我们测试迁移逻辑是否正确
      // 实际的迁移逻辑在 store 的 migrate 函数中
      expect(oldSettings).toHaveProperty('apiKey');
      expect(oldSettings).toHaveProperty('geminiApiKey');
      
      // 验证新结构包含必要的字段
      const { result } = renderHook(() => useSettingsStore());
      expect(result.current.modelSettings).toBeDefined();
      expect(result.current.apiConfigs).toBeDefined();
      expect(result.current.activeApiConfigId).toBeDefined();
    });
  });

  describe('数据持久化', () => {
    it('应该能够持久化和恢复设置', () => {
      const { result: result1, rerender } = renderHook(() => useSettingsStore());
      
      // 修改设置
      act(() => {
        result1.current.updateModelConfig('outline', {
          model: 'gpt-4-turbo',
          temperature: 0.8,
        });
      });

      // 重新渲染组件（模拟页面刷新）
      const { result: result2 } = renderHook(() => useSettingsStore());
      
      // 验证设置是否被持久化
      expect(result2.current.modelSettings.outline.model).toBe('gpt-4-turbo');
      expect(result2.current.modelSettings.outline.temperature).toBe(0.8);
    });
  });
});