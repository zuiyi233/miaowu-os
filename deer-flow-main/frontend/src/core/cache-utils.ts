export interface TimedCacheEntry<T> {
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  hits: number;
}

export interface TimedCacheSnapshot {
  label: string;
  size: number;
  ttlMs: number;
  maxSize: number;
  hits: number;
  misses: number;
  ttlEvictions: number;
  capacityEvictions: number;
  entries: Array<{
    key: string;
    createdAt: number;
    lastAccessedAt: number;
    hits: number;
  }>;
}

export interface TimedCacheOptions {
  label: string;
  ttlMs: number;
  maxSize: number;
  logger?: Pick<Console, "info" | "warn" | "debug">;
}

export interface TimedOrderedCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
  size(): number;
  snapshot(): TimedCacheSnapshot;
}

export function createTimedOrderedCache<T>(
  options: TimedCacheOptions,
): TimedOrderedCache<T> {
  const entries = new Map<string, TimedCacheEntry<T>>();
  const logger = options.logger ?? console;
  let hits = 0;
  let misses = 0;
  let ttlEvictions = 0;
  let capacityEvictions = 0;

  const now = () => Date.now();

  const evictExpired = (timestamp: number) => {
    const expiredKeys: string[] = [];
    for (const [key, entry] of entries) {
      if (options.ttlMs > 0 && timestamp - entry.lastAccessedAt >= options.ttlMs) {
        expiredKeys.push(key);
      }
    }
    if (expiredKeys.length === 0) {
      return;
    }
    for (const key of expiredKeys) {
      entries.delete(key);
    }
    ttlEvictions += expiredKeys.length;
    logger.info?.(`🗑️ ${options.label} TTL 淘汰 ${expiredKeys.length} 项`);
  };

  const evictOldest = () => {
    if (entries.size < options.maxSize) {
      return;
    }
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    entries.delete(oldestKey);
    capacityEvictions += 1;
    logger.info?.(`🗑️ ${options.label} 容量淘汰 1 项`);
  };

  return {
    get(key: string) {
      const timestamp = now();
      evictExpired(timestamp);
      const entry = entries.get(key);
      if (!entry) {
        misses += 1;
        return undefined;
      }
      entry.hits += 1;
      entry.lastAccessedAt = timestamp;
      entries.delete(key);
      entries.set(key, entry);
      hits += 1;
      return entry.value;
    },

    set(key: string, value: T) {
      const timestamp = now();
      evictExpired(timestamp);
      const existing = entries.get(key);
      if (existing) {
        existing.value = value;
        existing.lastAccessedAt = timestamp;
        entries.delete(key);
        entries.set(key, existing);
        return;
      }

      evictOldest();
      entries.set(key, {
        value,
        createdAt: timestamp,
        lastAccessedAt: timestamp,
        hits: 0,
      });
    },

    delete(key: string) {
      return entries.delete(key);
    },

    clear() {
      const count = entries.size;
      entries.clear();
      logger.info?.(`🧹 ${options.label} 缓存已清空，共 ${count} 项`);
    },

    size() {
      return entries.size;
    },

    snapshot() {
      return {
        label: options.label,
        size: entries.size,
        ttlMs: options.ttlMs,
        maxSize: options.maxSize,
        hits,
        misses,
        ttlEvictions,
        capacityEvictions,
        entries: Array.from(entries.entries()).map(([key, entry]) => ({
          key,
          createdAt: entry.createdAt,
          lastAccessedAt: entry.lastAccessedAt,
          hits: entry.hits,
        })),
      };
    },
  };
}
