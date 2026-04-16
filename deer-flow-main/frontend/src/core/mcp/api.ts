import { getBackendBaseURL } from "@/core/config";

import type { MCPConfig } from "./types";

function normalizeMCPConfig(payload: unknown): MCPConfig {
  const data = (payload ?? {}) as Record<string, unknown>;
  const rawServers =
    (data.mcp_servers as Record<string, unknown> | undefined) ??
    (data.mcpServers as Record<string, unknown> | undefined) ??
    {};
  return {
    mcp_servers: rawServers as MCPConfig["mcp_servers"],
  };
}

export async function loadMCPConfig() {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`);
  if (!response.ok) {
    throw new Error(`Failed to load MCP config: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return normalizeMCPConfig(payload);
}

export async function updateMCPConfig(config: MCPConfig) {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error(`Failed to update MCP config: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return normalizeMCPConfig(payload);
}
