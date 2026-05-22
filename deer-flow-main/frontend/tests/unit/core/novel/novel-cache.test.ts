import { expect, test, vi } from "vitest";

import { clearNovelCache, getCachedOrLoadNovel } from "@/core/novel/novel-cache";

function createCacheFacade<T>() {
  const store = new Map<string, T>();

  return {
    get: vi.fn((novelId: string) => store.get(novelId)),
    set: vi.fn((novelId: string, value: T) => {
      store.set(novelId, value);
    }),
    delete: vi.fn((novelId: string) => store.delete(novelId)),
    clear: vi.fn(() => {
      store.clear();
    }),
    store,
  };
}

test("getCachedOrLoadNovel reuses a previously loaded novel", async () => {
  const cache = createCacheFacade<{ id: string }>();
  let loaderCalls = 0;

  const first = await getCachedOrLoadNovel(cache, "novel-1", async () => {
    loaderCalls += 1;
    return { id: "novel-1" };
  });
  const second = await getCachedOrLoadNovel(cache, "novel-1", async () => {
    loaderCalls += 1;
    return { id: "novel-1" };
  });

  expect(first).toEqual({ id: "novel-1" });
  expect(second).toEqual({ id: "novel-1" });
  expect(loaderCalls).toBe(1);
  expect(cache.set).toHaveBeenCalledTimes(1);
});

test("clearNovelCache clears one entry or the whole cache", () => {
  const cache = createCacheFacade<{ id: string }>();
  cache.set("novel-1", { id: "novel-1" });
  cache.set("novel-2", { id: "novel-2" });

  clearNovelCache(cache, "novel-1");
  expect(cache.delete).toHaveBeenCalledWith("novel-1");
  expect(cache.store.has("novel-1")).toBe(false);
  expect(cache.store.has("novel-2")).toBe(true);

  clearNovelCache(cache);
  expect(cache.clear).toHaveBeenCalledTimes(1);
  expect(cache.store.size).toBe(0);
});
