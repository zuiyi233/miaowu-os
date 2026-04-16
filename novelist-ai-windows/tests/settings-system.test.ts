import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useSettingsStore } from "../stores/useSettingsStore";
import { SettingsDialog } from "../components/SettingsDialog";
import { databaseService } from "../lib/storage/db";
import { toast } from "sonner";

// Mock toast functions
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock database service
vi.mock("../lib/storage/db", () => ({
  databaseService: {
    getAllNovels: vi.fn(),
    saveNovel: vi.fn(),
    exportAllData: vi.fn(),
    importData: vi.fn(),
    clearAllData: vi.fn(),
  },
}));

describe("设置系统功能完整性测试", () => {
  let queryClient: QueryClient;
  let mockOnClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    });

    mockOnClose = vi.fn();

    // 重置设置 store
    useSettingsStore.getState().resetSettings();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderWithQueryClient = (component: React.ReactElement) => {
    return render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        component
      )
    );
  };

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
  });

  describe("设置对话框组件", () => {
    it("应该正确渲染设置对话框", () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      expect(screen.getByText("应用设置")).toBeInTheDocument();
      expect(screen.getByText("编辑器")).toBeInTheDocument();
      expect(screen.getByText("AI & API")).toBeInTheDocument();
      expect(screen.getByText("数据管理")).toBeInTheDocument();
    });

    it("应该显示当前设置值", () => {
      // 修改一些设置
      useSettingsStore.getState().setSettings({
        autoSaveDelay: 1000,
        editorFont: "Fira Code" as const,
      });

      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      // 检查编辑器标签页
      expect(screen.getByDisplayValue("1000")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Fira Code")).toBeInTheDocument();
    });

    it("应该能够切换自动保存开关", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const autoSaveSwitch = screen.getByRole("switch", {
        name: "autoSaveEnabled",
      });

      // 初始状态应该是开启的
      expect(autoSaveSwitch).toBeChecked();

      // 点击关闭自动保存
      fireEvent.click(autoSaveSwitch);

      // 验证开关状态已更新
      expect(autoSaveSwitch).not.toBeChecked();
    });

    it("应该能够调整自动保存延迟", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const slider = screen.getByRole("slider");

      // 初始值应该是 500
      expect(slider).toHaveValue("500");

      // 调整滑块到 1000
      fireEvent.input(slider, { target: { value: "1000" } });

      // 验证滑块值已更新
      expect(slider).toHaveValue("1000");
    });

    it("应该能够保存设置并关闭对话框", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const saveButton = screen.getByText("保存设置");
      const cancelButton = screen.getByText("取消");

      // 点击保存按钮
      fireEvent.click(saveButton);

      // 验证成功提示
      expect(toast.success).toHaveBeenCalledWith("设置已保存！");

      // 验证关闭回调被调用
      expect(mockOnClose).toHaveBeenCalled();
    });

    it("应该能够取消编辑并关闭对话框", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const cancelButton = screen.getByText("取消");

      // 修改一些设置
      const slider = screen.getByRole("slider");
      fireEvent.input(slider, { target: { value: "1000" } });

      // 点击取消按钮
      fireEvent.click(cancelButton);

      // 验证关闭回调被调用
      expect(mockOnClose).toHaveBeenCalled();

      // 验证设置没有被保存（通过检查 store 状态）
      const settings = useSettingsStore.getState();
      expect(settings.autoSaveDelay).toBe(500); // 应该还是默认值
    });
  });

  describe("数据管理功能", () => {
    it("应该能够导出数据", async () => {
      const mockNovels = [
        {
          title: "测试小说1",
          outline: "测试大纲1",
          volumes: [],
          chapters: [],
          characters: [],
          settings: [],
          factions: [],
        },
        {
          title: "测试小说2",
          outline: "测试大纲2",
          volumes: [],
          chapters: [],
          characters: [],
          settings: [],
          factions: [],
        },
      ];

      vi.mocked(databaseService.exportAllData).mockResolvedValue({
        novels: mockNovels,
      });

      // 创建一个模拟的下载链接
      const mockCreateObjectURL = vi.fn().mockReturnValue("blob:mock-url");
      const mockRevokeObjectURL = vi.fn();
      const mockCreateElement = vi.fn().mockReturnValue({
        href: "",
        download: "",
        click: vi.fn(),
      });
      const mockAppendChild = vi.fn();
      const mockRemoveChild = vi.fn();

      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;
      global.document.createElement = mockCreateElement;
      global.document.body.appendChild = mockAppendChild;
      global.document.body.removeChild = mockRemoveChild;

      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const exportButton = screen.getByText("导出所有数据");

      // 点击导出按钮
      fireEvent.click(exportButton);

      // 等待异步操作完成
      await waitFor(() => {
        expect(databaseService.exportAllData).toHaveBeenCalled();
        expect(mockCreateObjectURL).toHaveBeenCalled();
        expect(mockCreateElement).toHaveBeenCalledWith("a");
        expect(toast.success).toHaveBeenCalledWith("数据已成功导出！");
      });
    });

    it("应该能够导入数据", async () => {
      const mockData = {
        version: 1,
        novels: [
          {
            title: "导入的小说",
            outline: "导入的大纲",
            volumes: [],
            chapters: [],
            characters: [],
            settings: [],
            factions: [],
          },
        ],
      };

      vi.mocked(databaseService.importData).mockResolvedValue();

      // 创建一个模拟的文件输入
      const mockFile = new File([JSON.stringify(mockData)], "test.json", {
        type: "application/json",
      });

      const mockFileReader = {
        readAsText: vi.fn(),
        onload: null as any,
        readAsDataURL: vi.fn(),
      };

      global.FileReader = vi
        .fn()
        .mockImplementation(() => mockFileReader) as any;

      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const importButton = screen.getByText("导入数据...");
      const fileInput = screen
        .getByRole("button", { hidden: true })
        .querySelector('input[type="file"]');

      // 模拟文件选择
      Object.defineProperty(fileInput, "files", {
        value: [mockFile],
        writable: false,
      });

      // 点击导入按钮
      fireEvent.click(importButton);

      // 模拟文件读取完成
      const mockOnLoad = vi.fn();
      mockFileReader.onload = mockOnLoad;
      mockOnLoad({ target: { result: JSON.stringify(mockData) } });

      // 等待异步操作完成
      await waitFor(() => {
        expect(databaseService.importData).toHaveBeenCalledWith(mockData);
        expect(toast.success).toHaveBeenCalledWith("数据导入成功！");
      });
    });

    it("应该能够清除缓存", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const clearCacheButton = screen.getByText("清除 React Query 缓存");

      // 点击清除缓存按钮
      fireEvent.click(clearCacheButton);

      // 验证查询客户端的 clear 方法被调用
      expect(queryClient.clear).toHaveBeenCalled();
    });
  });

  describe("重置功能", () => {
    it("应该显示重置确认对话框", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const resetButton = screen.getByText("重置所有设置");

      // 点击重置按钮
      fireEvent.click(resetButton);

      // 验证确认对话框出现
      await waitFor(() => {
        expect(screen.getByText("您确定要重置应用吗？")).toBeInTheDocument();
        expect(
          screen.getByText(
            "此操作将重置所有设置为默认值，但不会删除您的小说数据。"
          )
        ).toBeInTheDocument();
      });
    });

    it("应该能够确认重置操作", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const resetButton = screen.getByText("重置所有设置");

      // 点击重置按钮
      fireEvent.click(resetButton);

      // 等待确认对话框出现
      await waitFor(() => {
        const confirmButton = screen.getByText("我确定，重置应用");
        fireEvent.click(confirmButton);
      });

      // 验证重置操作被执行
      const settings = useSettingsStore.getState();
      expect(settings.autoSaveEnabled).toBe(true);
      expect(settings.autoSaveDelay).toBe(500);
      expect(toast.success).toHaveBeenCalledWith("应用已重置！");
    });

    it("应该能够取消重置操作", async () => {
      renderWithQueryClient(
        React.createElement(SettingsDialog, { onClose: mockOnClose })
      );

      const resetButton = screen.getByText("重置所有设置");

      // 点击重置按钮
      fireEvent.click(resetButton);

      // 等待确认对话框出现
      await waitFor(() => {
        const cancelButton = screen.getByText("取消");
        fireEvent.click(cancelButton);
      });

      // 验证设置没有被重置
      const settings = useSettingsStore.getState();
      expect(settings.autoSaveEnabled).toBe(true);
      expect(settings.autoSaveDelay).toBe(500);
    });
  });
});
