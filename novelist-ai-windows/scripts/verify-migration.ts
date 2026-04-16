/**
 * 数据迁移验证脚本
 *
 * 简单的验证脚本，用于测试 IndexedDB 存储和数据迁移功能
 * 遵循 KISS 原则，保持简单直接
 */

import "fake-indexeddb/auto";
import {
  indexedDBStorage,
  DataMigration,
} from "../lib/storage/indexedDBStorage";

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

async function runVerification() {
  console.log("🚀 开始验证 IndexedDB 数据迁移功能...\n");

  const testKey = "mi-jing-novelist-storage";
  const testData = {
    state: {
      novel: {
        title: "测试小说",
        outline: "这是一个测试大纲",
        chapters: [
          { id: "ch1", title: "第一章", content: "<p>第一章内容</p>" },
          { id: "ch2", title: "第二章", content: "" },
        ],
        characters: [],
        settings: [],
      },
      activeChapterId: "ch1",
      isGeneratingOutline: false,
      isContinuingStory: false,
    },
    version: 0,
  };

  try {
    // 测试 1: IndexedDB 基本存储功能
    console.log("📝 测试 1: IndexedDB 基本存储功能");
    await indexedDBStorage.setItem(testKey, JSON.stringify(testData));
    const retrievedData = await indexedDBStorage.getItem(testKey);

    if (
      retrievedData &&
      JSON.parse(retrievedData).state.novel.title === testData.state.novel.title
    ) {
      console.log("✅ IndexedDB 存储和检索功能正常");
    } else {
      console.log("❌ IndexedDB 存储和检索功能异常");
      return;
    }

    // 清理测试数据
    await indexedDBStorage.removeItem(testKey);
    mockLocalStorage.clear();

    // 测试 2: 数据迁移功能
    console.log("\n📝 测试 2: 数据迁移功能");

    // 在 localStorage 中设置测试数据
    mockLocalStorage.setItem(testKey, JSON.stringify(testData));
    console.log("📦 已在 localStorage 中设置测试数据");

    // 执行迁移
    const migrationResult = await DataMigration.migrateFromLocalStorage(
      testKey
    );

    if (migrationResult) {
      console.log("✅ 数据迁移成功");

      // 验证迁移后的数据
      const migratedData = await indexedDBStorage.getItem(testKey);
      if (migratedData) {
        const parsedData = JSON.parse(migratedData);
        if (parsedData.state.novel.title === testData.state.novel.title) {
          console.log("✅ 迁移数据完整性验证通过");
        } else {
          console.log("❌ 迁移数据完整性验证失败");
          return;
        }
      } else {
        console.log("❌ 无法从 IndexedDB 检索迁移后的数据");
        return;
      }
    } else {
      console.log("❌ 数据迁移失败");
      return;
    }

    // 测试 3: 重复迁移保护
    console.log("\n📝 测试 3: 重复迁移保护");

    // 修改 localStorage 数据
    const differentData = {
      ...testData,
      state: {
        ...testData.state,
        novel: {
          ...testData.state.novel,
          title: "不同的标题",
        },
      },
    };
    mockLocalStorage.setItem(testKey, JSON.stringify(differentData));

    // 再次执行迁移
    const secondMigrationResult = await DataMigration.migrateFromLocalStorage(
      testKey
    );

    if (secondMigrationResult) {
      // 验证 IndexedDB 中的数据没有被覆盖
      const currentData = await indexedDBStorage.getItem(testKey);
      if (currentData) {
        const parsedData = JSON.parse(currentData);
        if (parsedData.state.novel.title === testData.state.novel.title) {
          console.log("✅ 重复迁移保护功能正常");
        } else {
          console.log("❌ 重复迁移保护功能异常");
          return;
        }
      }
    }

    // 测试 4: localStorage 清理功能
    console.log("\n📝 测试 4: localStorage 清理功能");
    DataMigration.clearLocalStorageData(testKey);

    if (mockLocalStorage.getItem(testKey) === null) {
      console.log("✅ localStorage 清理功能正常");
    } else {
      console.log("❌ localStorage 清理功能异常");
      return;
    }

    console.log("\n🎉 所有测试通过！IndexedDB 数据迁移功能验证成功！");
  } catch (error) {
    console.error("❌ 验证过程中发生错误:", error);
  } finally {
    // 清理测试数据
    try {
      await indexedDBStorage.removeItem(testKey);
      mockLocalStorage.clear();
    } catch (error) {
      console.error("清理测试数据时发生错误:", error);
    }
  }
}

// 运行验证
runVerification();
