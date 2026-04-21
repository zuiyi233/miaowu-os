import { getBackendBaseURL } from "@/core/config";

export type DraftMediaKind = "image" | "audio";
export type DraftMediaRetention = "24h" | "7d" | "never";

export interface DraftMediaItem {
  id: string;
  kind: DraftMediaKind;
  created_at: string;
  expires_at: string | null;
  mime_type: string;
  content_url: string;
  prompt?: string;
  text?: string;
  model?: string;
  voice?: string;
  format?: string;
}

export type DraftMediaMap = Record<string, DraftMediaItem>;

export type DraftAttachTargetType = "project" | "character" | "scene";

export interface DraftAttachResponse {
  success: boolean;
  asset_id?: string;
  content_url?: string;
  mime_type?: string;
  kind?: string;
  target_updated?: boolean;
  target_update_error?: string | null;
}

function withBackendBase(url: string): string {
  if (!url) {
    return url;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  const base = getBackendBaseURL();
  if (url.startsWith("/")) {
    return `${base}${url}`;
  }
  return `${base}/${url}`;
}

export function resolveDraftContentUrl(item: DraftMediaItem): string {
  return withBackendBase(item.content_url);
}

function isDraftMediaKind(value: unknown): value is DraftMediaKind {
  return value === "image" || value === "audio";
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDraftMediaItem(value: unknown): value is DraftMediaItem {
  if (!isStringRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    isDraftMediaKind(value.kind) &&
    typeof value.created_at === "string" &&
    typeof value.content_url === "string" &&
    typeof value.mime_type === "string" &&
    (typeof value.expires_at === "string" || value.expires_at === null) &&
    (value.prompt === undefined || typeof value.prompt === "string") &&
    (value.text === undefined || typeof value.text === "string") &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.voice === undefined || typeof value.voice === "string") &&
    (value.format === undefined || typeof value.format === "string")
  );
}

export function normalizeDraftMediaMap(value: unknown): DraftMediaMap {
  if (!isStringRecord(value)) {
    return {};
  }

  const result: DraftMediaMap = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isDraftMediaItem(candidate)) {
      continue;
    }
    const id = candidate.id.trim() || key.trim();
    if (!id) {
      continue;
    }
    result[id] = {
      ...candidate,
      id,
    };
  }
  return result;
}

export async function deleteDraftMedia(
  threadId: string,
  draftId: string,
): Promise<void> {
  const backend = getBackendBaseURL();
  const response = await fetch(
    `${backend}/api/threads/${encodeURIComponent(threadId)}/media/drafts/${encodeURIComponent(draftId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail?: unknown }).detail ?? "")
        : "";
    throw new Error(detail || "Failed to delete draft.");
  }
}

export async function attachDraftMedia(
  threadId: string,
  draftId: string,
  targetType: DraftAttachTargetType,
  targetId: string,
): Promise<DraftAttachResponse> {
  const backend = getBackendBaseURL();
  const response = await fetch(
    `${backend}/api/threads/${encodeURIComponent(threadId)}/media/drafts/${encodeURIComponent(draftId)}/attach`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: targetType, target_id: targetId }),
    },
  );
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail?: unknown }).detail ?? "")
        : "";
    throw new Error(detail || "Failed to attach draft.");
  }
  return payload as DraftAttachResponse;
}
