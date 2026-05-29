export interface MCPServerConfig extends Record<string, unknown> {
  enabled: boolean;
  system_enabled: boolean;
  description: string;
  type?: string;
  url?: string | null;
  command?: string | null;
  name?: string;
}

export interface MCPConfig {
  version?: number;
  mcp_servers: Record<string, MCPServerConfig>;
  is_admin?: boolean;
}
