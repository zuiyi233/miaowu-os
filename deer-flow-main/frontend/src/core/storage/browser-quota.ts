"use client";

import { fetch, resolveApiUrl } from "@/core/api/fetcher";

export const DEFAULT_BROWSER_STORAGE_QUOTA_BYTES = 100 * 1024 * 1024;

export class BrowserStorageQuotaError extends Error {
  readonly code = "browser_storage_quota_exceeded";
  constructor(
    readonly quotaBytes: number,
    readonly usedBytes: number,
    readonly incomingBytes: number,
  ) {
    super("browser_storage_quota_exceeded");
  }
}

export interface BrowserQuotaConfig {
  quotaBytes: number;
  enabled: boolean;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function keySize(key: string, value: string | null): number {
  return byteSize(key) + byteSize(value ?? "");
}

async function fetchQuotaConfig(): Promise<BrowserQuotaConfig> {
  if (!isBrowser()) {
    return { quotaBytes: DEFAULT_BROWSER_STORAGE_QUOTA_BYTES, enabled: true };
  }
  try {
    const res = await fetch(resolveApiUrl("/api/account/storage-usage"));
    if (!res.ok) {
      return { quotaBytes: DEFAULT_BROWSER_STORAGE_QUOTA_BYTES, enabled: true };
    }
    const data = await res.json();
    return {
      quotaBytes:
        Number(data?.browser?.quota_bytes) ||
        DEFAULT_BROWSER_STORAGE_QUOTA_BYTES,
      enabled: data?.browser?.enabled !== false,
    };
  } catch {
    return { quotaBytes: DEFAULT_BROWSER_STORAGE_QUOTA_BYTES, enabled: true };
  }
}

class BrowserStorageQuotaService {
  private config: BrowserQuotaConfig = {
    quotaBytes: DEFAULT_BROWSER_STORAGE_QUOTA_BYTES,
    enabled: true,
  };
  private configLoaded = false;

  async refreshConfig(): Promise<BrowserQuotaConfig> {
    this.config = await fetchQuotaConfig();
    this.configLoaded = true;
    return this.config;
  }

  private async getConfig(): Promise<BrowserQuotaConfig> {
    if (!this.configLoaded) {
      return this.refreshConfig();
    }
    return this.config;
  }

  estimateLocalStorageUsage(): number {
    if (!isBrowser()) return 0;
    let total = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      total += keySize(key, localStorage.getItem(key));
    }
    return total;
  }

  estimateSessionStorageUsage(): number {
    if (!isBrowser()) return 0;
    let total = 0;
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      total += keySize(key, sessionStorage.getItem(key));
    }
    return total;
  }

  estimateAppControlledUsage(): number {
    return this.estimateLocalStorageUsage() + this.estimateSessionStorageUsage();
  }

  async estimateBrowserUsageReference(): Promise<number> {
    if (!isBrowser() || !navigator.storage?.estimate) {
      return 0;
    }
    try {
      const estimate = await navigator.storage.estimate();
      return Number(estimate.usage ?? 0);
    } catch {
      return 0;
    }
  }

  async assertCanWrite(
    storage: Storage,
    key: string,
    nextValue: string,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) return;
    const current = storage.getItem(key);
    const currentUsage = await this.estimateBrowserUsageReference();
    const delta = keySize(key, nextValue) - keySize(key, current);
    const incoming = Math.max(0, delta);
    if (currentUsage + incoming > config.quotaBytes) {
      throw new BrowserStorageQuotaError(
        config.quotaBytes,
        currentUsage,
        incoming,
      );
    }
  }

  async assertBrowserWriteBudget(incomingBytes = 0): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) return;
    const currentUsage = await this.estimateBrowserUsageReference();
    const incoming = Math.max(0, Number(incomingBytes) || 0);
    if (currentUsage + incoming > config.quotaBytes) {
      throw new BrowserStorageQuotaError(
        config.quotaBytes,
        currentUsage,
        incoming,
      );
    }
  }

  async setLocalItem(key: string, value: string): Promise<void> {
    if (!isBrowser()) return;
    await this.assertCanWrite(localStorage, key, value);
    localStorage.setItem(key, value);
    void this.reportUsage();
  }

  async setSessionItem(key: string, value: string): Promise<void> {
    if (!isBrowser()) return;
    await this.assertCanWrite(sessionStorage, key, value);
    sessionStorage.setItem(key, value);
    void this.reportUsage();
  }

  removeLocalItem(key: string): void {
    if (!isBrowser()) return;
    localStorage.removeItem(key);
    void this.reportUsage();
  }

  removeSessionItem(key: string): void {
    if (!isBrowser()) return;
    sessionStorage.removeItem(key);
    void this.reportUsage();
  }

  async reportUsage(): Promise<void> {
    if (!isBrowser()) return;
    try {
      const usedBytes = await this.estimateBrowserUsageReference();
      await fetch(resolveApiUrl("/api/account/browser-storage-usage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ used_bytes: usedBytes }),
      });
    } catch {
      // Browser usage reports are best-effort display data, not billing truth.
    }
  }

  clearAppControlledStorage(): void {
    if (!isBrowser()) return;
    const localKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter(Boolean) as string[];
    const sessionKeys = Array.from(
      { length: sessionStorage.length },
      (_, index) => sessionStorage.key(index),
    ).filter(Boolean) as string[];
    for (const key of localKeys) localStorage.removeItem(key);
    for (const key of sessionKeys) sessionStorage.removeItem(key);
    void this.reportUsage();
  }
}

export const browserStorageQuotaService = new BrowserStorageQuotaService();
