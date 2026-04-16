/**
 * 应用功能完整性验证脚本
 *
 * 验证应用在 IndexedDB 迁移后的核心功能是否正常工作
 * 遵循 KISS 原则，专注于关键功能验证
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  indexedDBStorage,
  DataMigration,
} from "../lib/storage/indexedDBStorage";
import type { Novel, Chapter } from "../types";

// 模拟浏览器环境
import "fake-indexeddb/auto";

// 模拟 localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

// 测试数据
const initialNovel: Novel = {
  title: "The Crimson Cipher",
  outline:
    "A young cryptographer in a neo-Victorian city discovers a hidden message in an ancient artifact, unraveling a conspiracy that threatens to topple the steam-powered society.",
  volumes: [], // 空卷列表
  chapters: [
    {
      id: "ch1",
      title: "The Gilded Cog",
      content:
        "<p>Elara adjusted her brass-rimmed spectacles, the gaslight of her workshop glinting off the intricate gears of the Antikythera mechanism she was tasked to restore.</p>",
    },
    { id: "ch2", title: "Whispers in the Wires", content: "" },
    { id: "ch3", title: "The Steam-Drake's Lair", content: "" },
  ],
  characters: [],
  settings: [],
};

// 创建测试 store
const createTestStore = () => {
  const STORAGE_KEY = "mi-jing-novelist-storage-test";

  interface NovelState {
    novel: Novel;
    activeChapterId: string;
    isGeneratingOutline: boolean;
    isContinuingStory: boolean;
    setActiveChapterId: (id: string) => void;
    updateChapterContent: (content: string) => void;
    setChapters: (chapters: Chapter[]) => void;
    setIsGeneratingOutline: (loading: boolean) => void;
    setIsContinuingStory: (loading: boolean) => void;
  }

  return create<NovelState>()(
    persist(
      (set) => ({
        novel: initialNovel,
        activeChapterId: "ch1",
        isGeneratingOutline: false,
        isContinuingStory: false,
        setActiveChapterId: (id) => set({ activeChapterId: id }),
        updateChapterContent: (newContent) =>
          set((state) => ({
            novel: {
              ...state.novel,
              chapters: state.novel.chapters.map((ch) =>
                ch.id === state.activeChapterId
                  ? { ...ch, content: newContent }
                  : ch
              ),
            },
          })),
        setChapters: (newChapters) =>
          set((state) => ({
            novel: { ...state.novel, chapters: newChapters },
            activeChapterId: newChapters[0]?.id || "",
          })),
        setIsGeneratingOutline: (loading) =>
          set({ isGeneratingOutline: loading }),
        setIsContinuingStory: (loading) => set({ isContinuingStory: loading }),
      }),
      {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => indexedDBStorage),
      }
    )
  );
};

async function runAppFunctionalityVerification() {
  console.log("🚀 开始验证应用功能完整性...\n");

  try {
    // 测试 1: Store 创建和初始化
    console.log("📝 测试 1: Store 创建和初始化");
    const testStore = createTestStore();

    const initialState = testStore.getState();
    if (
      initialState.novel.title === initialNovel.title &&
      initialState.activeChapterId === "ch1"
    ) {
      console.log("✅ Store 初始化成功");
    } else {
      console.log("❌ Store 初始化失败");
      return;
    }

    // 测试 2: 章节内容更新
    console.log("\n📝 测试 2: 章节内容更新");
    const newContent = "<p>这是新的章节内容，用于测试更新功能。</p>";
    testStore.getState().updateChapterContent(newContent);

    const updatedState = testStore.getState();
    const currentChapter = updatedState.novel.chapters.find(
      (ch) => ch.id === updatedState.activeChapterId
    );

    if (currentChapter?.content === newContent) {
      console.log("✅ 章节内容更新功能正常");
    } else {
      console.log("❌ 章节内容更新功能异常");
      return;
    }

    // 测试 3: 章节切换
    console.log("\n📝 测试 3: 章节切换");
    testStore.getState().setActiveChapterId("ch2");

    const switchedState = testStore.getState();
    if (switchedState.activeChapterId === "ch2") {
      console.log("✅ 章节切换功能正常");
    } else {
      console.log("❌ 章节切换功能异常");
      return;
    }

    // 测试 4: 章节列表更新
    console.log("\n📝 测试 4: 章节列表更新");
    const newChapters: Chapter[] = [
      { id: "ch1", title: "新章节1", content: "<p>新章节1内容</p>" },
      { id: "ch2", title: "新章节2", content: "<p>新章节2内容</p>" },
    ];

    testStore.getState().setChapters(newChapters);

    const chaptersUpdatedState = testStore.getState();
    if (
      chaptersUpdatedState.novel.chapters.length === 2 &&
      chaptersUpdatedState.activeChapterId === "ch1"
    ) {
      console.log("✅ 章节列表更新功能正常");
    } else {
      console.log("❌ 章节列表更新功能异常");
      return;
    }

    // 测试 5: 状态持久化
    console.log("\n📝 测试 5: 状态持久化");
    // 创建新的 store 实例来测试持久化
    const persistedStore = createTestStore();

    // 等待一小段时间让持久化完成
    await new Promise((resolve) => setTimeout(resolve, 100));

    const persistedState = persistedStore.getState();
    if (
      persistedState.novel.chapters.length === 2 &&
      persistedState.novel.chapters[0].title === "新章节1"
    ) {
      console.log("✅ 状态持久化功能正常");
    } else {
      console.log("❌ 状态持久化功能异常");
      return;
    }

    // 测试 6: 加载状态管理
    console.log("\n📝 测试 6: 加载状态管理");
    testStore.getState().setIsGeneratingOutline(true);
    testStore.getState().setIsContinuingStory(true);

    const loadingState = testStore.getState();
    if (loadingState.isGeneratingOutline && loadingState.isContinuingStory) {
      console.log("✅ 加载状态管理功能正常");
    } else {
      console.log("❌ 加载状态管理功能异常");
      return;
    }

    console.log(
      "\n🎉 所有应用功能测试通过！IndexedDB 迁移后应用功能完整性验证成功！"
    );
  } catch (error) {
    console.error("❌ 验证过程中发生错误:", error);
  }
}

// 运行验证
runAppFunctionalityVerification();
