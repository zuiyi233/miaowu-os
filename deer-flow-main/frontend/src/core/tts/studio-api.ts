import { fetch as authFetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

export type TtsStudioNodeType =
  | "referenceAudio"
  | "voiceStyle"
  | "prompt"
  | "voiceClone"
  | "voiceDesign"
  | "artifact";

export interface TtsStudioNode {
  id: string;
  type: TtsStudioNodeType;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface TtsStudioEdge {
  id: string;
  source: string;
  target: string;
}

export interface TtsStudioArtifact {
  asset_id: string;
  url?: string | null;
  download_url?: string | null;
  content_type?: string | null;
  provider?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TtsStudioBoard {
  version: number;
  nodes: TtsStudioNode[];
  edges: TtsStudioEdge[];
  stash: TtsStudioArtifact[];
}

export interface TtsStudioWorkspace {
  id: string;
  name: string;
  board: TtsStudioBoard;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TtsStudioWorkspaceListResponse {
  items: TtsStudioWorkspace[];
}

function ttsStudioUrl(path: string): string {
  return `${getBackendBaseURL()}/api/tts/studio/workspaces${path}`;
}

async function readError(res: Response): Promise<Error> {
  let message = `TTS studio request failed: ${res.status}`;
  try {
    const body = await res.json();
    if (body && typeof body === "object") {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
        message = String((detail as { message: string }).message);
      }
    }
  } catch {}
  return new Error(message);
}

export async function listTtsStudioWorkspaces(): Promise<TtsStudioWorkspace[]> {
  const res = await authFetch(ttsStudioUrl(""));
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as TtsStudioWorkspaceListResponse;
  return data.items ?? [];
}

export async function createTtsStudioWorkspace(name?: string): Promise<TtsStudioWorkspace> {
  const res = await authFetch(ttsStudioUrl(""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function loadTtsStudioWorkspace(workspaceId: string): Promise<TtsStudioWorkspace> {
  const res = await authFetch(ttsStudioUrl(`/${encodeURIComponent(workspaceId)}`));
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function saveTtsStudioWorkspace(workspace: TtsStudioWorkspace): Promise<TtsStudioWorkspace> {
  const res = await authFetch(ttsStudioUrl(`/${encodeURIComponent(workspace.id)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: workspace.name, board: workspace.board }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function deleteTtsStudioWorkspace(workspaceId: string): Promise<void> {
  const res = await authFetch(ttsStudioUrl(`/${encodeURIComponent(workspaceId)}`), {
    method: "DELETE",
  });
  if (!res.ok) throw await readError(res);
}

export async function runTtsStudioNode(
  workspaceId: string,
  nodeId: string,
  board?: TtsStudioBoard,
): Promise<{ workspace: TtsStudioWorkspace; node_id: string; artifact: TtsStudioArtifact; diagnostics?: string[] }> {
  const res = await authFetch(ttsStudioUrl(`/${encodeURIComponent(workspaceId)}/run-node`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ node_id: nodeId, board }),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function exportTtsStudioWorkspace(
  workspaceId: string,
  assetIds: string[],
): Promise<Blob> {
  const res = await authFetch(ttsStudioUrl(`/${encodeURIComponent(workspaceId)}/export`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds }),
  });
  if (!res.ok) throw await readError(res);
  return res.blob();
}
