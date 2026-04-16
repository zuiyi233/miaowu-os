import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUiStore } from "../stores/useUiStore";

// Mock logger
vi.mock("../lib/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Novel Switching Store Functionality", () => {
  beforeEach(() => {
    // Reset store state before each test
    useUiStore.setState({
      activeChapterId: "ch1",
      currentNovelTitle: "The Crimson Cipher",
      isGeneratingOutline: false,
      isContinuingStory: false,
      isLoading: false,
      isAiPanelCollapsed: false,
      isHistorySheetOpen: false,
      isCommandPaletteOpen: false,
      dirtyContent: null,
      versionHistory: [],
      isLoadingVersionHistory: false,
    });
  });

  describe("setCurrentNovelTitle", () => {
    it("should update current novel title", () => {
      const { setCurrentNovelTitle } = useUiStore.getState();

      setCurrentNovelTitle("New Novel Title");

      const state = useUiStore.getState();
      expect(state.currentNovelTitle).toBe("New Novel Title");
    });

    it("should reset active chapter when switching novels", () => {
      const { setCurrentNovelTitle } = useUiStore.getState();

      // Set an active chapter first
      useUiStore.setState({ activeChapterId: "chapter-123" });
      expect(useUiStore.getState().activeChapterId).toBe("chapter-123");

      // Switch novel
      setCurrentNovelTitle("Another Novel");

      // Check that active chapter was reset
      const state = useUiStore.getState();
      expect(state.currentNovelTitle).toBe("Another Novel");
      expect(state.activeChapterId).toBe("");
    });
  });

  describe("setActiveChapterId", () => {
    it("should update active chapter ID", () => {
      const { setActiveChapterId } = useUiStore.getState();

      setActiveChapterId("chapter-456");

      const state = useUiStore.getState();
      expect(state.activeChapterId).toBe("chapter-456");
    });
  });

  describe("initial state", () => {
    it("should have correct default values", () => {
      const state = useUiStore.getState();

      expect(state.currentNovelTitle).toBe("The Crimson Cipher");
      expect(state.activeChapterId).toBe("ch1");
      expect(state.isGeneratingOutline).toBe(false);
      expect(state.isContinuingStory).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.isAiPanelCollapsed).toBe(false);
      expect(state.isHistorySheetOpen).toBe(false);
      expect(state.isCommandPaletteOpen).toBe(false);
      expect(state.dirtyContent).toBeNull();
      expect(state.versionHistory).toEqual([]);
      expect(state.isLoadingVersionHistory).toBe(false);
    });
  });
});
