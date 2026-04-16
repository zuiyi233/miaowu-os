import { create } from "zustand";

interface AiStreamState {
  isStreaming: boolean;
  latestChunk: string | null;
  seq: number;
}

interface UiState {
  activeChapterId: string;
  currentNovelTitle: string;
  viewMode: "home" | "editor" | "graph" | "timeline" | "chat" | "outline";
  isGeneratingOutline: boolean;
  isContinuingStory: boolean;
  isLoading: boolean;
  isAiPanelCollapsed: boolean;
  isHistorySheetOpen: boolean;
  isCommandPaletteOpen: boolean;
  dirtyContent: string | null;
  versionHistory: any[];
  isLoadingVersionHistory: boolean;
  aiStream: AiStreamState;

  setActiveChapterId: (id: string) => void;
  setCurrentNovelTitle: (title: string) => void;
  setViewMode: (mode: "home" | "editor" | "graph" | "timeline" | "chat" | "outline") => void;
  setIsGeneratingOutline: (loading: boolean) => void;
  setIsContinuingStory: (loading: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsAiPanelCollapsed: (collapsed: boolean) => void;
  setIsHistorySheetOpen: (open: boolean) => void;
  setIsCommandPaletteOpen: (open: boolean) => void;
  setDirtyContent: (content: string | null) => void;
  setVersionHistory: (history: any[]) => void;
  setIsLoadingVersionHistory: (loading: boolean) => void;
  startAiStream: () => void;
  pushAiStreamChunk: (chunk: string) => void;
  endAiStream: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeChapterId: "",
  currentNovelTitle: "",
  viewMode: "home",
  isGeneratingOutline: false,
  isContinuingStory: false,
  isLoading: false,
  isAiPanelCollapsed: false,
  isHistorySheetOpen: false,
  isCommandPaletteOpen: false,
  dirtyContent: null,
  versionHistory: [],
  isLoadingVersionHistory: false,
  aiStream: {
    isStreaming: false,
    latestChunk: null,
    seq: 0,
  },

  setActiveChapterId: (id) => set({ activeChapterId: id }),
  setCurrentNovelTitle: (title) => set({ currentNovelTitle: title, activeChapterId: "" }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setIsGeneratingOutline: (loading) => set({ isGeneratingOutline: loading }),
  setIsContinuingStory: (loading) => set({ isContinuingStory: loading }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsAiPanelCollapsed: (collapsed) => set({ isAiPanelCollapsed: collapsed }),
  setIsHistorySheetOpen: (open) => set({ isHistorySheetOpen: open }),
  setIsCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
  setDirtyContent: (content) => set({ dirtyContent: content }),
  setVersionHistory: (history) => set({ versionHistory: history }),
  setIsLoadingVersionHistory: (loading) => set({ isLoadingVersionHistory: loading }),

  startAiStream: () => set({
    aiStream: { isStreaming: true, latestChunk: null, seq: 0 },
    isContinuingStory: true,
  }),

  pushAiStreamChunk: (chunk) =>
    set((state) => ({
      aiStream: {
        isStreaming: true,
        latestChunk: chunk,
        seq: state.aiStream.seq + 1,
      },
    })),

  endAiStream: () => set({
    aiStream: { isStreaming: false, latestChunk: null, seq: 0 },
    isContinuingStory: false,
  }),
}));
