import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";
import type { Skill } from "@/core/skills/type";

export interface AdminMcpServerConfig {
  enabled: boolean;
  type: string;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  description?: string;
}

export interface AdminMcpConfigResponse {
  mcp_servers: Record<string, AdminMcpServerConfig>;
}

export interface AdminSkillHistoryEntry extends Record<string, unknown> {
  ts?: string;
  action?: string;
  author?: string;
}

export interface AdminCustomSkillResponse extends Skill {
  content: string;
}

function apiUrl(path: string): string {
  return `${getBackendBaseURL()}${path}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : `Request failed with status ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}

export async function loadAdminMcpConfig(): Promise<AdminMcpConfigResponse> {
  const response = await fetch(apiUrl("/api/mcp/config"));
  return parseJsonResponse<AdminMcpConfigResponse>(response);
}

export async function updateAdminMcpConfig(
  payload: AdminMcpConfigResponse,
): Promise<AdminMcpConfigResponse> {
  const response = await fetch(apiUrl("/api/mcp/config"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<AdminMcpConfigResponse>(response);
}

export async function loadAdminCustomSkills(): Promise<Skill[]> {
  const response = await fetch(apiUrl("/api/skills/custom"));
  const payload = await parseJsonResponse<{ skills: Skill[] }>(response);
  return payload.skills;
}

export async function loadAdminCustomSkill(
  skillName: string,
): Promise<AdminCustomSkillResponse> {
  const response = await fetch(
    apiUrl(`/api/skills/custom/${encodeURIComponent(skillName)}`),
  );
  return parseJsonResponse<AdminCustomSkillResponse>(response);
}

export async function updateAdminCustomSkill(
  skillName: string,
  content: string,
): Promise<AdminCustomSkillResponse> {
  const response = await fetch(
    apiUrl(`/api/skills/custom/${encodeURIComponent(skillName)}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  return parseJsonResponse<AdminCustomSkillResponse>(response);
}

export async function deleteAdminCustomSkill(skillName: string): Promise<void> {
  const response = await fetch(
    apiUrl(`/api/skills/custom/${encodeURIComponent(skillName)}`),
    { method: "DELETE" },
  );
  await parseJsonResponse<{ success: boolean }>(response);
}

export async function loadAdminSkillHistory(
  skillName: string,
): Promise<AdminSkillHistoryEntry[]> {
  const response = await fetch(
    apiUrl(`/api/skills/custom/${encodeURIComponent(skillName)}/history`),
  );
  const payload = await parseJsonResponse<{ history: AdminSkillHistoryEntry[] }>(
    response,
  );
  return payload.history;
}

export async function rollbackAdminCustomSkill(
  skillName: string,
  historyIndex = -1,
): Promise<AdminCustomSkillResponse> {
  const response = await fetch(
    apiUrl(`/api/skills/custom/${encodeURIComponent(skillName)}/rollback`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history_index: historyIndex }),
    },
  );
  return parseJsonResponse<AdminCustomSkillResponse>(response);
}
