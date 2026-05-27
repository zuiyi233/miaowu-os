import { fetch as authFetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

export interface MediaAsset {
  id: string;
  user_id: string;
  project_id?: string | null;
  purpose: string;
  filename: string;
  mime_type?: string | null;
  size_bytes: number;
  content_hash?: string | null;
  storage_backend?: string | null;
  bucket?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

function mediaAssetsUrl(path: string): string {
  return `${getBackendBaseURL()}/media-assets${path}`;
}

export async function uploadMediaAsset(
  file: File,
  options: { purpose?: string; project_id?: string; metadata?: Record<string, unknown> } = {},
): Promise<MediaAsset> {
  const form = new FormData();
  form.append("file", file);
  form.append("purpose", options.purpose ?? "attachment");
  if (options.project_id) form.append("project_id", options.project_id);
  if (options.metadata) form.append("metadata_json", JSON.stringify(options.metadata));
  const res = await authFetch(mediaAssetsUrl("/upload"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Media asset upload failed: ${res.status}`);
  }
  return res.json();
}

export async function getMediaAsset(assetId: string): Promise<MediaAsset> {
  const res = await authFetch(mediaAssetsUrl(`/${encodeURIComponent(assetId)}`));
  if (!res.ok) {
    throw new Error(`Media asset load failed: ${res.status}`);
  }
  return res.json();
}
