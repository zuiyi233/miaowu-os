/**
 * IndexedDB 数据迁移测试
 *
 * 验证从 localStorage 到 IndexedDB 的数据迁移功能
 * 确保数据完整性和迁移过程的可靠性
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  indexedDBStorage,
  DataMigration,
} from "../../lib/storage/indexedDBStorage";

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

// 替换全局 localStorage
Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("IndexedDB 存储适配器", () => {
  const testKey = "test-storage-key";
  const testData = { message: "Hello IndexedDB!", timestamp: Date.now() };

  beforeEach(async () => {
    // 清理测试数据
    await indexedDBStorage.removeItem(testKey);
    mockLocalStorage.clear();
  });

  afterEach(async () => {
    // 清理测试数据
    await indexedDBStorage.removeItem(testKey);
    mockLocalStorage.clear();
  });

  it("应该能够存储和检索数据", async () => {
    // 存储数据
    await indexedDBStorage.setItem(testKey, JSON.stringify(testData));

    // 检索数据
    const retrievedData = await indexedDBStorage.getItem(testKey);

    expect(retrievedData).not.toBeNull();
    expect(JSON.parse(retrievedData!)).toEqual(testData);
  });

  it("应该能够删除数据", async () => {
    // 存储数据
    await indexedDBStorage.setItem(testKey, JSON.stringify(testData));

    // 确认数据存在
    const beforeDelete = await indexedDBStorage.getItem(testKey);
    expect(beforeDelete).not.toBeNull();

    // 删除数据
    await indexedDBStorage.removeItem(testKey);

    // 确认数据已删除
    const afterDelete = await indexedDBStorage.getItem(testKey);
    expect(afterDelete).toBeNull();
  });

  it("处理不存在的键应该返回 null", async () => {
    const nonExistentKey = "non-existent-key";
    const result = await indexedDBStorage.getItem(nonExistentKey);
    expect(result).toBeNull();
  });
});

describe("数据迁移功能", () => {
  const storageKey = "mi-jing-novelist-storage";
  const mockNovelData = {
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

  beforeEach(async () => {
    // 清理测试数据
    await indexedDBStorage.removeItem(storageKey);
    mockLocalStorage.clear();
  });

  afterEach(async () => {
    // 清理测试数据
    await indexedDBStorage.removeItem(storageKey);
    mockLocalStorage.clear();
  });

  it("应该能够从 localStorage 迁移数据到 IndexedDB", async () => {
    // 在 localStorage 中设置测试数据
    mockLocalStorage.setItem(storageKey, JSON.stringify(mockNovelData));

    // 执行迁移
    const migrationResult = await DataMigration.migrateFromLocalStorage(
      storageKey
    );

    expect(migrationResult).toBe(true);

    // 验证数据已迁移到 IndexedDB
    const indexedDBData = await indexedDBStorage.getItem(storageKey);
    expect(indexedDBData).not.toBeNull();

    const parsedData = JSON.parse(indexedDBData!);
    expect(parsedData).toEqual(mockNovelData);
  });

  it("当 IndexedDB 中已存在数据时应该跳过迁移", async () => {
    // 先在 IndexedDB 中设置数据
    await indexedDBStorage.setItem(storageKey, JSON.stringify(mockNovelData));

    // 在 localStorage 中设置不同的数据
    const differentData = {
      ...mockNovelData,
      state: {
        ...mockNovelData.state,
        novel: { ...mockNovelData.state.novel, title: "不同的标题" },
      },
    };
    mockLocalStorage.setItem(storageKey, JSON.stringify(differentData));

    // 执行迁移
    const migrationResult = await DataMigration.migrateFromLocalStorage(
      storageKey
    );

    expect(migrationResult).toBe(true);

    // 验证 IndexedDB 中的数据没有被覆盖
    const indexedDBData = await indexedDBStorage.getItem(storageKey);
    const parsedData = JSON.parse(indexedDBData!);
    expect(parsedData.state.novel.title).toBe("测试小说"); // 保持原始数据
  });

  it("当 localStorage 中没有数据时应该跳过迁移", async () => {
    // 不在 localStorage 中设置数据

    // 执行迁移
    const migrationResult = await DataMigration.migrateFromLocalStorage(
      storageKey
    );

    expect(migrationResult).toBe(true);

    // 验证 IndexedDB 中没有数据
    const indexedDBData = await indexedDBStorage.getItem(storageKey);
    expect(indexedDBData).toBeNull();
  });

  it("应该能够清理 localStorage 数据", () => {
    // 在 localStorage 中设置数据
    mockLocalStorage.setItem(storageKey, JSON.stringify(mockNovelData));

    // 确认数据存在
    expect(mockLocalStorage.getItem(storageKey)).not.toBeNull();

    // 清理数据
    DataMigration.clearLocalStorageData(storageKey);

    // 确认数据已清理
    expect(mockLocalStorage.getItem(storageKey)).toBeNull();
  });
});

describe("错误处理", () => {
  it("应该处理无效的 JSON 数据", async () => {
    const invalidKey = "invalid-json-key";

    // 尝试存储无效的 JSON 数据
    await expect(
      indexedDBStorage.setItem(invalidKey, "invalid-json")
    ).rejects.toThrow();
  });

  it("应该处理迁移过程中的错误", async () => {
    const invalidKey = "invalid-migration-key";

    // 在 localStorage 中设置无效数据
    mockLocalStorage.setItem(invalidKey, "invalid-json");

    // 执行迁移应该返回 false 而不是抛出错误
    const migrationResult = await DataMigration.migrateFromLocalStorage(
      invalidKey
    );
    expect(migrationResult).toBe(false);
  });
});
