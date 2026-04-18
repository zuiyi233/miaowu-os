import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Novel, Chapter, Character, Outline } from './schemas';

type ViewMode = 'home' | 'editor' | 'reader' | 'graph' | 'timeline' | 'chat' | 'outline' | 'careers' | 'foreshadows' | 'settings';

type CollectionKey = 'chapters' | 'characters' | 'outlines';
type CollectionItem<K extends CollectionKey> = K extends 'chapters' ? Chapter : K extends 'characters' ? Character : Outline;

function createCollectionActions<K extends CollectionKey>(key: K) {
  const singular = key.slice(0, -1) as Capitalize<CollectionItem<K> extends Chapter ? 'chapter' : CollectionItem<K> extends Character ? 'character' : 'outline'>;
  return {
    [`set${key.charAt(0).toUpperCase() + key.slice(1)}`]: (items: CollectionItem<K>[]) => set({ [key]: items }),
    [`add${singular}`]: (item: CollectionItem<K>) =>
      set((state) => ({ [key]: [...(state[key] as CollectionItem<K>[]), item] })),
    [`update${singular}`]: (id: string, updates: Partial<CollectionItem<K>>) =>
      set((state) => ({
        [key]: (state[key] as CollectionItem<K>[]).map((item) =>
          item.id === id ? { ...item, ...updates } : item,
        ),
      })),
    [`remove${singular}`]: (id: string) =>
      set((state) => ({
        [key]: (state[key] as CollectionItem<K>[]).filter((item) => item.id !== id),
      })),
  } as const;
}

interface NovelState {
  currentNovelTitle: string | null;
  activeChapterId: string | null;
  activeVolumeId: string | null;
  viewMode: ViewMode;
  novels: Novel[];
  chapters: Chapter[];
  characters: Character[];
  outlines: Outline[];
  isLoading: boolean;
  isDirty: boolean;
  dirtyContent: string | null;

  isGeneratingOutline: boolean;
  isContinuingStory: boolean;
  isAiPanelCollapsed: boolean;
  isHistorySheetOpen: boolean;
  isCommandPaletteOpen: boolean;
  isImmersive: boolean;
  versionHistory: unknown[];
  isLoadingVersionHistory: boolean;

  setCurrentNovelTitle: (title: string | null) => void;
  setActiveChapterId: (id: string | null) => void;
  setActiveVolumeId: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setNovels: (novels: Novel[]) => void;
  setChapters: (chapters: Chapter[]) => void;
  addChapter: (chapter: Chapter) => void;
  updateChapter: (chapterId: string, updates: Partial<Chapter>) => void;
  removeChapter: (chapterId: string) => void;
  setCharacters: (characters: Character[]) => void;
  addCharacter: (character: Character) => void;
  updateCharacter: (characterId: string, updates: Partial<Character>) => void;
  removeCharacter: (characterId: string) => void;
  setOutlines: (outlines: Outline[]) => void;
  addOutline: (outline: Outline) => void;
  updateOutline: (outlineId: string, updates: Partial<Outline>) => void;
  removeOutline: (outlineId: string) => void;
  setLoading: (loading: boolean) => void;
  setDirtyContent: (content: string | null) => void;
  markDirty: () => void;
  markClean: () => void;

  setIsGeneratingOutline: (loading: boolean) => void;
  setIsContinuingStory: (loading: boolean) => void;
  setIsAiPanelCollapsed: (collapsed: boolean) => void;
  setIsHistorySheetOpen: (open: boolean) => void;
  setIsCommandPaletteOpen: (open: boolean) => void;
  setIsImmersive: (immersive: boolean) => void;
  setVersionHistory: (history: unknown[]) => void;
  setIsLoadingVersionHistory: (loading: boolean) => void;
}

export const useNovelStore = create<NovelState>()(
  persist(
    (set) => ({
      currentNovelTitle: null,
      activeChapterId: null,
      activeVolumeId: null,
      viewMode: 'home',
      novels: [],
      chapters: [],
      characters: [],
      outlines: [],
      isLoading: false,
      isDirty: false,
      dirtyContent: null,

      isGeneratingOutline: false,
      isContinuingStory: false,
      isAiPanelCollapsed: false,
      isHistorySheetOpen: false,
      isCommandPaletteOpen: false,
      isImmersive: false,
      versionHistory: [],
      isLoadingVersionHistory: false,

      setCurrentNovelTitle: (title) => set({ currentNovelTitle: title }),
      setActiveChapterId: (id) => set({ activeChapterId: id }),
      setActiveVolumeId: (id) => set({ activeVolumeId: id }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setNovels: (novels) => set({ novels }),
      setChapters: (chapters) => set({ chapters }),
      ...createCollectionActions('chapters'),
      ...createCollectionActions('characters'),
      ...createCollectionActions('outlines'),
      setLoading: (loading) => set({ isLoading: loading }),
      setDirtyContent: (content) => set({ dirtyContent: content, isDirty: content !== null }),
      markDirty: () => set({ isDirty: true }),
      markClean: () => set({ isDirty: false, dirtyContent: null }),

      setIsGeneratingOutline: (loading) => set({ isGeneratingOutline: loading }),
      setIsContinuingStory: (loading) => set({ isContinuingStory: loading }),
      setIsAiPanelCollapsed: (collapsed) => set({ isAiPanelCollapsed: collapsed }),
      setIsHistorySheetOpen: (open) => set({ isHistorySheetOpen: open }),
      setIsCommandPaletteOpen: (open) => set({ isCommandPaletteOpen: open }),
      setIsImmersive: (immersive) => set({ isImmersive: immersive }),
      setVersionHistory: (history) => set({ versionHistory: history }),
      setIsLoadingVersionHistory: (loading) => set({ isLoadingVersionHistory: loading }),
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
