import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../stores/useSettingsStore";

describe("设置存储功能测试", () => {
  beforeEach(() => {
    // 重置设置 store
    useSettingsStore.getState().resetSettings();
  });

  it("应该正确初始化默认设置", () => {
    const settings = useSettingsStore.getState();

    expect(settings.autoSaveEnabled).toBe(true);
    expect(settings.autoSaveDelay).toBe(5 * 60 * 1000); // 5分钟
    expect(settings.autoSnapshotEnabled).toBe(true);
    expect(settings.editorFont).toBe("Lora");
    expect(settings.editorFontSize).toBe(18);
    
    // 新的结构化设置
    expect(settings.apiConfigs).toHaveLength(2);
    expect(settings.activeApiConfigId).toBe('default-newapi');
    expect(settings.modelSettings.outline.model).toBe('gemini-1.5-flash');
    expect(settings.modelSettings.polish.temperature).toBe(0.5);
  });

  it("应该能够添加新的 API 配置", () => {
    const { addApiConfig } = useSettingsStore.getState();

    addApiConfig({
      name: '测试配置',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key-123',
    });

    const settings = useSettingsStore.getState();
    expect(settings.apiConfigs).toHaveLength(3);
    expect(settings.apiConfigs[2]).toMatchObject({
      name: '测试配置',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key-123',
    });
  });

  it("应该能够更新 API 配置", () => {
    const { updateApiConfig } = useSettingsStore.getState();

    updateApiConfig('default-newapi', {
      name: '更新的配置',
      apiKey: 'updated-key-456',
    });

    const settings = useSettingsStore.getState();
    const config = settings.apiConfigs.find(c => c.id === 'default-newapi');
    expect(config).toMatchObject({
      name: '更新的配置',
      apiKey: 'updated-key-456',
      baseUrl: 'https://api.openai.com/v1', // 应该保持不变
    });
  });

  it("应该能够删除 API 配置", () => {
    const { addApiConfig, removeApiConfig } = useSettingsStore.getState();

    addApiConfig({
      name: '临时配置',
      baseUrl: 'https://api.temp.com/v1',
      apiKey: 'temp-key',
    });

    let settings = useSettingsStore.getState();
    expect(settings.apiConfigs).toHaveLength(3);

    removeApiConfig('default-gemini');

    settings = useSettingsStore.getState();
    expect(settings.apiConfigs).toHaveLength(2);
    expect(settings.apiConfigs.find(c => c.id === 'default-gemini')).toBeUndefined();
  });

  it("删除激活配置时应该自动切换到其他配置", () => {
    const { removeApiConfig } = useSettingsStore.getState();

    removeApiConfig('default-newapi');

    const settings = useSettingsStore.getState();
    expect(settings.activeApiConfigId).toBe('default-gemini');
  });

  it("应该能够更新模型配置", () => {
    const { updateModelConfig } = useSettingsStore.getState();

    updateModelConfig('outline', {
      model: 'gpt-4',
      temperature: 0.9,
      maxTokens: 8192,
    });

    const settings = useSettingsStore.getState();
    expect(settings.modelSettings.outline).toMatchObject({
      model: 'gpt-4',
      temperature: 0.9,
      maxTokens: 8192,
    });
  });

  it("应该能够更新编辑器设置", () => {
    const { setSettings } = useSettingsStore.getState();

    setSettings({
      autoSaveEnabled: false,
      autoSaveDelay: 1500 * 60 * 1000, // 转换为毫秒
      autoSnapshotEnabled: false,
      editorFont: "Plus Jakarta Sans" as const,
      editorFontSize: 20,
    });

    const updatedSettings = useSettingsStore.getState();
    expect(updatedSettings.autoSaveEnabled).toBe(false);
    expect(updatedSettings.autoSaveDelay).toBe(1500 * 60 * 1000);
    expect(updatedSettings.autoSnapshotEnabled).toBe(false);
    expect(updatedSettings.editorFont).toBe("Plus Jakarta Sans");
    expect(updatedSettings.editorFontSize).toBe(20);
  });
});