import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { MCPConfig } from "./types";

export async function loadUserToolSettings() {
  const response = await fetch(`${getBackendBaseURL()}/api/user/tool-settings`);
  return response.json() as Promise<MCPConfig>;
}

export async function updateUserToolSettings(enabledMcpServers: Record<string, boolean>) {
  const response = await fetch(`${getBackendBaseURL()}/api/user/tool-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enabled_mcp_servers: enabledMcpServers,
    }),
  });
  return response.json() as Promise<MCPConfig>;
}
