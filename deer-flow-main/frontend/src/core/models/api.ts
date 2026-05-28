import { getBackendBaseURL } from "../config";

import type { ModelsResponse } from "./types";

export async function loadModels(): Promise<ModelsResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/models`, {
    credentials: "include",
  });
  const data = (await res.json()) as Partial<ModelsResponse>;
  return {
    models: data.models ?? [],
    token_usage: data.token_usage ?? { enabled: false },
    default_model_name: data.default_model_name ?? null,
    default_provider_id: data.default_provider_id ?? null,
  };
}
