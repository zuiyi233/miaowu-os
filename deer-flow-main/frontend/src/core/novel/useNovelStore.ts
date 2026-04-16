import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Novel, Chapter } from './schemas';

interface NovelState {
  currentNovelTitle: string | null;
  activeChapterId: string | null;
  activeVolumeId: string | null;
  viewMode: 'home' | 'editor' | 'graph' | 'timeline' | 'chat' | 'outline' | 'settings';
  novels: Novel[];
  chapters: Chapter[];
  isLoading: boolean;
  isDirty: boolean;
  dirtyContent: string | null;

  setCurrentNovelTitle: (title: string | null) => void;
  setActiveChapterId: (id: string | null) => void;
  setActiveVolumeId: (id: string | null) => void;
  setViewMode: (mode: NovelState['viewMode']) => void;
  setNovels: (novels: Novel[]) => void;
  setChapters: (chapters: Chapter[]) => void;
  setLoading: (loading: boolean) => void;
  setDirtyContent: (content: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
}

export const useNovelStore = create<NovelState>()(
  persist(
    (set, get) => ({
      currentNovelTitle: null,
      activeChapterId: null,
      activeVolumeId: null,
      viewMode: 'home',
      novels: [],
      chapters: [],
      isLoading: false,
      isDirty: false,
      dirtyContent: null,

      setCurrentNovelTitle: (title) => set({ currentNovelTitle: title }),
      setActiveChapterId: (id) => set({ activeChapterId: id }),
      setActiveVolumeId: (id) => set({ activeVolumeId: id }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setNovels: (novels) => set({ novels }),
      setChapters: (chapters) => set({ chapters }),
      setLoading: (loading) => set({ isLoading: loading }),
      setDirtyContent: (content) => set({ dirtyContent: content, isDirty: content !== null }),
      markDirty: () => set({ isDirty: true }),
      markClean: () => set({ isDirty: false, dirtyContent: null }),
    }),
    {
      name: 'novel-ui-store',
      partialize: (state) => ({
        currentNovelTitle: state.currentNovelTitle,
        activeChapterId: state.activeChapterId,
        activeVolumeId: state.activeVolumeId,
        viewMode: state.viewMode,
      }),
    }
  )
);
