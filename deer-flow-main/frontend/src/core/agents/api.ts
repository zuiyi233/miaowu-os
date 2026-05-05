import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { Agent, CreateAgentRequest, UpdateAgentRequest } from "./types";

const BACKEND_UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

export class AgentNameCheckError extends Error {
  constructor(
    message: string,
    public readonly reason: "backend_unreachable" | "request_failed",
  ) {
    super(message);
    this.name = "AgentNameCheckError";
  }
}

export class AgentsApiDisabledError extends Error {
  constructor(message?: string) {
    super(message ?? "Agents API is disabled.");
    this.name = "AgentsApiDisabledError";
  }
}

function isAgentsApiDisabledDetail(detail: string | undefined): boolean {
  return typeof detail === "string" && detail.includes("agents_api.enabled");
}

type ApiErrorPayload = {
  detail?: string;
  message?: string;
  error?: string;
};

async function readErrorDetail(res: Response): Promise<string | undefined> {
  const payload = (await res.json().catch(() => ({}))) as ApiErrorPayload;
  if (typeof payload.detail === "string" && payload.detail.trim().length > 0) {
    return payload.detail;
  }
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error;
  }
  return undefined;
}

export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents`);
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    if (isAgentsApiDisabledDetail(detail)) {
      throw new AgentsApiDisabledError(detail);
    }
    throw new Error(
      detail ?? `Failed to load agents: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { agents: Agent[] };
  return data.agents;
}

export async function getAgent(name: string): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`);
  if (!res.ok) throw new Error(`Agent '${name}' not found`);
  return res.json() as Promise<Agent>;
}

export async function createAgent(request: CreateAgentRequest): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    if (isAgentsApiDisabledDetail(detail)) {
      throw new AgentsApiDisabledError(detail);
    }
    throw new Error(detail ?? `Failed to create agent: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function updateAgent(
  name: string,
  request: UpdateAgentRequest,
): Promise<Agent> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(err.detail ?? `Failed to update agent: ${res.statusText}`);
  }
  return res.json() as Promise<Agent>;
}

export async function deleteAgent(name: string): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/agents/${name}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete agent: ${res.statusText}`);
}

export async function checkAgentName(
  name: string,
): Promise<{ available: boolean; name: string }> {
  let res: Response;
  try {
    res = await fetch(
      `${getBackendBaseURL()}/api/agents/check?name=${encodeURIComponent(name)}`,
    );
  } catch {
    throw new AgentNameCheckError(
      "Could not reach the DeerFlow backend.",
      "backend_unreachable",
    );
  }

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    if (isAgentsApiDisabledDetail(detail)) {
      throw new AgentsApiDisabledError(detail);
    }
    if (BACKEND_UNAVAILABLE_STATUSES.has(res.status)) {
      throw new AgentNameCheckError(
        "Could not reach the DeerFlow backend.",
        "backend_unreachable",
      );
    }
    throw new AgentNameCheckError(
      detail ?? `Failed to check agent name: ${res.statusText}`,
      "request_failed",
    );
  }
  return res.json() as Promise<{ available: boolean; name: string }>;
}
