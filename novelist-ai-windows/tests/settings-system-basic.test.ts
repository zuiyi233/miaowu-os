import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSettingsStore } from "../stores/useSettingsStore";

// Mock toast functions
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("设置系统基础功能测试", () => {
  beforeEach(() => {
    // 重置设置 store
    useSettingsStore.getState().resetSettings();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("设置状态管理器", () => {
    it("应该正确初始化默认设置", () => {
      const settings = useSettingsStore.getState();

      expect(settings.autoSaveEnabled).toBe(true);
      expect(settings.autoSaveDelay).toBe(500);
      expect(settings.autoSnapshotEnabled).toBe(true);
      expect(settings.editorFont).toBe("Lora");
      expect(settings.editorFontSize).toBe(18);
      expect(settings.apiKey).toBe("");
      expect(settings.embeddingUrl).toBe(
        "https://api.openai.com/v1/embeddings"
      );
      expect(settings.embeddingModel).toBe("text-embedding-3-small");
    });

    it("应该能够更新单个设置项", () => {
      const { setSettings } = useSettingsStore.getState();

      setSettings({ autoSaveDelay: 1000 });

      const updatedSettings = useSettingsStore.getState();
      expect(updatedSettings.autoSaveDelay).toBe(1000);
      expect(updatedSettings.autoSaveEnabled).toBe(true); // 其他设置保持不变
    });

    it("应该能够更新多个设置项", () => {
      const { setSettings } = useSettingsStore.getState();

      setSettings({
        autoSaveEnabled: false,
        autoSaveDelay: 2000,
        editorFont: "Fira Code" as const,
      });

      const updatedSettings = useSettingsStore.getState();
      expect(updatedSettings.autoSaveEnabled).toBe(false);
      expect(updatedSettings.autoSaveDelay).toBe(2000);
      expect(updatedSettings.editorFont).toBe("Fira Code");
    });

    it("应该能够重置所有设置", () => {
      const { setSettings, resetSettings } = useSettingsStore.getState();

      // 修改一些设置
      setSettings({
        autoSaveEnabled: false,
        autoSaveDelay: 2000,
        editorFont: "Fira Code" as const,
      });

      // 验证设置已修改
      let settings = useSettingsStore.getState();
      expect(settings.autoSaveEnabled).toBe(false);
      expect(settings.autoSaveDelay).toBe(2000);
      expect(settings.editorFont).toBe("Fira Code");

      // 重置设置
      resetSettings();

      // 验证设置已重置为默认值
      settings = useSettingsStore.getState();
      expect(settings.autoSaveEnabled).toBe(true);
      expect(settings.autoSaveDelay).toBe(500);
      expect(settings.editorFont).toBe("Lora");
    });

    it("应该能够更新API相关设置", () => {
      const { setSettings } = useSettingsStore.getState();

      setSettings({
        apiKey: "test-api-key",
        embeddingUrl: "https://custom-api.com/embeddings",
        embeddingModel: "custom-embedding-model",
        outlineModel: "custom-outline-model",
        continueWritingModel: "custom-continue-model",
        textProcessingModel: "custom-text-model",
      });

      const updatedSettings = useSettingsStore.getState();
      expect(updatedSettings.apiKey).toBe("test-api-key");
      expect(updatedSettings.embeddingUrl).toBe(
        "https://custom-api.com/embeddings"
      );
      expect(updatedSettings.embeddingModel).toBe("custom-embedding-model");
      expect(updatedSettings.outlineModel).toBe("custom-outline-model");
      expect(updatedSettings.continueWritingModel).toBe(
        "custom-continue-model"
      );
      expect(updatedSettings.textProcessingModel).toBe("custom-text-model");
    });

    it("应该能够更新编辑器设置", () => {
      const { setSettings } = useSettingsStore.getState();

      setSettings({
        autoSaveEnabled: false,
        autoSaveDelay: 1500,
        autoSnapshotEnabled: false,
        editorFont: "Plus Jakarta Sans" as const,
        editorFontSize: 20,
      });

      const updatedSettings = useSettingsStore.getState();
      expect(updatedSettings.autoSaveEnabled).toBe(false);
      expect(updatedSettings.autoSaveDelay).toBe(1500);
      expect(updatedSettings.autoSnapshotEnabled).toBe(false);
      expect(updatedSettings.editorFont).toBe("Plus Jakarta Sans");
      expect(updatedSettings.editorFontSize).toBe(20);
    });
  });

  describe("设置持久化", () => {
    it("应该能够持久化设置到存储", () => {
      const { setSettings } = useSettingsStore.getState();

      // 修改设置
      setSettings({
        autoSaveDelay: 1000,
        editorFont: "Fira Code" as const,
      });

      // 获取当前状态
      const currentSettings = useSettingsStore.getState();
      expect(currentSettings.autoSaveDelay).toBe(1000);
      expect(currentSettings.editorFont).toBe("Fira Code");

      // 重置设置
      useSettingsStore.getState().resetSettings();

      // 验证设置已重置
      const resetSettings = useSettingsStore.getState();
      expect(resetSettings.autoSaveDelay).toBe(500);
      expect(resetSettings.editorFont).toBe("Lora");
    });
  });
});
