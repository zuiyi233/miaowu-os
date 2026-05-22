import { create } from 'zustand';

interface EditorState {
  toolbarOpen: boolean;
  aiToolbarVisible: boolean;
  showChapterInfo: boolean;
  wordCount: number;
  charCount: number;

  setToolbarOpen: (open: boolean) => void;
  setAiToolbarVisible: (visible: boolean) => void;
  setShowChapterInfo: (show: boolean) => void;
  setWordCount: (count: number) => void;
  setCharCount: (count: number) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  toolbarOpen: true,
  aiToolbarVisible: false,
  showChapterInfo: true,
  wordCount: 0,
  charCount: 0,

  setToolbarOpen: (open) => set({ toolbarOpen: open }),
  setAiToolbarVisible: (visible) => set({ aiToolbarVisible: visible }),
  setShowChapterInfo: (show) => set({ showChapterInfo: show }),
  setWordCount: (count) => set({ wordCount: count }),
  setCharCount: (count) => set({ charCount: count }),
}));
