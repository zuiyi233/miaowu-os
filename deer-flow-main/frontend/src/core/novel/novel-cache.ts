import { createTimedOrderedCache } from "@/core/cache-utils";

// Keep the novel cache small and short-lived: the editor usually bounces
// between a few recent novels, so a 30s / 32-entry window avoids repeated
// fetches without letting stale entries accumulate.
export const NOVEL_CACHE_TTL_MS = 30_000;
export const NOVEL_CACHE_MAX_SIZE = 32;

export interface NovelCacheStore<T> {
  get(novelId: string): T | undefined;
  set(novelId: string, novel: T): void;
  delete(novelId: string): unknown;
  clear(): unknown;
}

export function createNovelCache<T>(label = "novel api novel cache"): NovelCacheStore<T> {
  return createTimedOrderedCache<T>({
    label,
    ttlMs: NOVEL_CACHE_TTL_MS,
    maxSize: NOVEL_CACHE_MAX_SIZE,
  });
}

export async function getCachedOrLoadNovel<T>(
  cache: NovelCacheStore<T>,
  novelId: string,
  loader: () => Promise<T | null>
): Promise<T | null> {
  const cached = cache.get(novelId);
  if (cached !== undefined) {
    return cached;
  }

  const novel = await loader();
  if (novel !== null) {
    cache.set(novelId, novel);
  }

  return novel;
}

export function clearNovelCache(
  cache: Pick<NovelCacheStore<unknown>, "delete" | "clear">,
  novelId?: string
): void {
  if (novelId) {
    cache.delete(novelId);
    return;
  }

  cache.clear();
}
