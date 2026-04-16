import { create } from "zustand";
import type { ChapterSnapshot } from "../lib/storage/db";
import { logger } from "../lib/logging";

/**
 * AI 流式状态接口
 */
interface AiStreamState {
  isStreaming: boolean;
  latestChunk: string | null; // 当前这一小块文本
  seq: number; // 序列号，用于强制触发 React 更新
}

/**
 * UI状态接口
 * 遵循单一职责原则，仅管理UI相关的临时状态
 */
interface UiState {
  // 当前激活的章节ID
  activeChapterId: string;

  // 当前选中的小说标题
  currentNovelTitle: string;

  // ✅ 新增状态：视图模式
  viewMode: "home" | "editor" | "graph" | "timeline" | "chat" | "outline";

  // 加载状态
  isGeneratingOutline: boolean;
  isContinuingStory: boolean;
  isLoading: boolean;

  // AI面板状态
  isAiPanelCollapsed: boolean;

  // 历史记录面板状态
  isHistorySheetOpen: boolean;

  // 命令面板状态
  isCommandPaletteOpen: boolean;

  // 编辑器脏内容状态 - 用于防止切换章节时丢失未保存的编辑内容
  dirtyContent: string | null;

  // 版本历史状态
  versionHistory: ChapterSnapshot[];
  isLoadingVersionHistory: boolean;

  // ✅ 新增：AI 流式状态
  aiStream: AiStreamState;

  // Actions
  setActiveChapterId: (id: string) => void;
  setCurrentNovelTitle: (title: string) => void;
  setViewMode: (
    mode: "home" | "editor" | "graph" | "timeline" | "chat" | "outline"
  ) => void; // ✅ 新增 Action
  setIsGeneratingOutline: (loading: boolean) => void;
  setIsContinuingStory: (loading: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsAiPanelCollapsed: (collapsed: boolean) => void;
  setIsHistorySheetOpen: (open: boolean) => void;
  setIsCommandPaletteOpen: (open: boolean) => void;
  setDirtyContent: (content: string | null) => void;
  setVersionHistory: (history: ChapterSnapshot[]) => void;
  setIsLoadingVersionHistory: (loading: boolean) => void;

  // ✅ 新增：AI 流式操作 Actions
  startAiStream: () => void;
  pushAiStreamChunk: (chunk: string) => void;
  endAiStream: () => void;
}

// 定义日志上下文
const STORE_CONTEXT = "UIStore";

// 日志中间件
const logMiddleware = (fn: any) => (set: any, get: any, api: any) => {
  const newSet = (args: any) => {
    // 为了性能，不记录高频的流式更新日志
    const isStreamUpdate = typeof args === "object" && args.aiStream;
    if (!isStreamUpdate) {
      const oldState = get();
      set(args);
      const newState = get();
      logger.debug(STORE_CONTEXT, "State changed", {
        action: args,
        oldState,
        newState,
      });
    } else {
      set(args);
    }
  };
  return fn(newSet, get, api);
};

/**
 * UI状态管理器
 * 使用 Zustand 进行纯UI状态管理
 * 遵循单一职责原则，仅负责UI状态管理，不涉及数据持久化
 */
export const useUiStore = create<UiState>(
  logMiddleware((set: any) => ({
    // 初始状态
    activeChapterId: "ch1",
    // 默认值设为硬编码的那个，保证向后兼容
    currentNovelTitle: "The Crimson Cipher",
    viewMode: "home", // ✅ 新增状态：默认为首页模式
    isGeneratingOutline: false,
    isContinuingStory: false,
    isLoading: false,
    isAiPanelCollapsed: false,
    isHistorySheetOpen: false,
    isCommandPaletteOpen: false,
    dirtyContent: null,
    versionHistory: [],
    isLoadingVersionHistory: false,

    // ✅ 新增：AI 流初始状态
    aiStream: {
      isStreaming: false,
      latestChunk: null,
      seq: 0,
    },

    // Actions
    setActiveChapterId: (id: string) => {
      logger.info(STORE_CONTEXT, `Action: setActiveChapterId`, { id });
      set({ activeChapterId: id });
    },

    setCurrentNovelTitle: (title: string) => {
      logger.info(STORE_CONTEXT, `Action: setCurrentNovelTitle`, { title });
      // 切换小说时重置选中章节
      set({ currentNovelTitle: title, activeChapterId: "" });
    },

    setViewMode: (
      mode: "home" | "editor" | "graph" | "timeline" | "chat" | "outline"
    ) => {
      logger.info(STORE_CONTEXT, `Action: setViewMode`, { mode });
      set({ viewMode: mode });
    },

    setIsGeneratingOutline: (loading: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsGeneratingOutline`, { loading });
      set({ isGeneratingOutline: loading });
    },

    setIsContinuingStory: (loading: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsContinuingStory`, { loading });
      set({ isContinuingStory: loading });
    },

    setIsLoading: (loading: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsLoading`, { loading });
      set({ isLoading: loading });
    },

    setIsAiPanelCollapsed: (collapsed: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsAiPanelCollapsed`, {
        collapsed,
      });
      set({ isAiPanelCollapsed: collapsed });
    },

    setIsHistorySheetOpen: (open: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsHistorySheetOpen`, { open });
      set({ isHistorySheetOpen: open });
    },

    setIsCommandPaletteOpen: (open: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsCommandPaletteOpen`, { open });
      set({ isCommandPaletteOpen: open });
    },

    setDirtyContent: (content: string | null) => {
      logger.info(STORE_CONTEXT, `Action: setDirtyContent`, {
        hasContent: content !== null,
        contentLength: content?.length || 0,
      });
      set({ dirtyContent: content });
    },

    setVersionHistory: (history: ChapterSnapshot[]) => {
      logger.info(STORE_CONTEXT, `Action: setVersionHistory`, {
        historyCount: history.length,
      });
      set({ versionHistory: history });
    },

    setIsLoadingVersionHistory: (loading: boolean) => {
      logger.info(STORE_CONTEXT, `Action: setIsLoadingVersionHistory`, {
        loading,
      });
      set({ isLoadingVersionHistory: loading });
    },

    // ✅ 新增：AI 流式操作实现
    startAiStream: () => {
      logger.info(STORE_CONTEXT, "Action: startAiStream");
      set({
        aiStream: { isStreaming: true, latestChunk: null, seq: 0 },
        isContinuingStory: true, // 同步更新旧的加载状态
      });
    },

    pushAiStreamChunk: (chunk: string) => {
      set((state: UiState) => ({
        aiStream: {
          isStreaming: true,
          latestChunk: chunk,
          seq: state.aiStream.seq + 1, // 递增序列号，强制触发 Effect
        },
      }));
    },

    endAiStream: () => {
      logger.info(STORE_CONTEXT, "Action: endAiStream");
      set({
        aiStream: { isStreaming: false, latestChunk: null, seq: 0 },
        isContinuingStory: false,
      });
    },
  }))
);
