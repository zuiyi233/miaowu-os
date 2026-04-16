import { create } from "zustand";
import { contextEngineService } from "../services/contextEngineService";
import { databaseService } from "../lib/storage/db";
import type {
  Character,
  Item,
  Faction,
  Setting,
  TimelineEvent,
} from "../types";
import { useUiStore } from "./useUiStore";

interface ActiveContextState {
  lastAnalyzedAt: number;
  isDirty: boolean; // ✅ 核心状态：标记上下文是否过期
  isAnalyzing: boolean;

  activeData: {
    characters: Character[];
    items: Item[];
    factions: Faction[];
    settings: Setting[];
    events: TimelineEvent[];
  };

  diff: {
    newIds: Set<string>;
    removedIds: Set<string>;
  };

  // ✅ 动作极其轻量化
  markDirty: () => void;

  // ✅ 这个动作只在用户点击按钮或生成时调用
  performAnalysis: (text: string) => Promise<void>;
}

export const useContextStore = create<ActiveContextState>((set, get) => ({
  lastAnalyzedAt: 0,
  isDirty: false,
  isAnalyzing: false,
  activeData: {
    characters: [],
    items: [],
    factions: [],
    settings: [],
    events: [],
  },
  diff: { newIds: new Set(), removedIds: new Set() },

  // ⚡️ 极其轻量的操作，Editor 输入时随意调用
  markDirty: () => {
    if (!get().isDirty) {
      set({ isDirty: true });
    }
  },

  performAnalysis: async (text: string) => {
    const novelTitle = useUiStore.getState().currentNovelTitle;
    if (!novelTitle || !text.trim()) return;

    set({ isAnalyzing: true });

    try {
      // 记录旧的 IDs
      const oldIds = new Set([
        ...get().activeData.characters.map((c) => c.id),
        ...get().activeData.items.map((i) => i.id),
        ...get().activeData.factions.map((f) => f.id),
        ...get().activeData.settings.map((s) => s.id),
        ...get().activeData.events.map((e) => e.id),
      ]);

      // 1. 分析
      const relevantIds = await contextEngineService.semanticRetrieve(
        text,
        novelTitle
      );

      // 2. 批量获取数据
      const [chars, items, events, settings, factions] = await Promise.all([
        databaseService.getCharactersByIds(relevantIds),
        databaseService.getItemsByIds(relevantIds),
        databaseService.getTimelineEventsByIds(relevantIds),
        databaseService.getSettingsByIds(relevantIds),
        databaseService.getFactionsByIds(relevantIds),
      ]);

      // 3. 计算 Diff
      const newActiveIds = new Set(relevantIds);
      const added = new Set([...newActiveIds].filter((x) => !oldIds.has(x)));
      const removed = new Set([...oldIds].filter((x) => !newActiveIds.has(x)));

      set({
        isDirty: false,
        lastAnalyzedAt: Date.now(),
        activeData: {
          characters: chars,
          items: items,
          events: events,
          settings: settings,
          factions: factions,
        },
        diff: {
          newIds: added,
          removedIds: removed,
        },
      });
    } catch (error) {
      console.error("Context analysis failed", error);
    } finally {
      set({ isAnalyzing: false });
    }
  },
}));
