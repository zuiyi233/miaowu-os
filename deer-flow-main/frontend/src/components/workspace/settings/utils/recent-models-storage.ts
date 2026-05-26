import { browserStorageQuotaService } from "@/core/storage/browser-quota";

export const RECENT_MODELS_KEY = "miaowu_recent_models";
export const MAX_RECENT_MODELS = 8;

export function loadRecentModels(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_MODELS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecentModel(modelName: string) {
  if (typeof window === "undefined") return;
  try {
    const recent = loadRecentModels().filter((m) => m !== modelName);
    recent.unshift(modelName);
    void browserStorageQuotaService.setLocalItem(
      RECENT_MODELS_KEY,
      JSON.stringify(recent.slice(0, MAX_RECENT_MODELS)),
    );
  } catch {
    // ignore
  }
}
