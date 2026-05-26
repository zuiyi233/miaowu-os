import type { AiFeatureModuleRoute } from "@/core/ai/feature-routing";
import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

export const CATEGORY_LABELS: Record<AiFeatureModuleRoute["category"], string> = {
  workspace: "主项目",
  agent: "智能体",
  novel: "小说",
  custom: "自定义",
};

export const MODEL_CAPABILITY_KEYWORDS: Record<string, string[]> = {
  thinking: ["o1", "o3", "o4", "deepseek-r1", "deepseek-reasoner", "claude-3.5-sonnet", "claude-4", "gemini-2.5", "qwen3", "qwq"],
  vision: ["vision", "gpt-4o", "gpt-4-turbo", "claude-3", "gemini", "qwen-vl", "glm-4v"],
  long_context: ["128k", "200k", "1m", "2m", "long", "claude-3", "gemini-1.5", "gemini-2.0"],
  fast: ["mini", "flash", "haiku", "turbo", "lite", "speed"],
};

export function getModelCapabilities(modelName: string): string[] {
  const lower = modelName.toLowerCase();
  const caps: string[] = [];
  for (const [cap, keywords] of Object.entries(MODEL_CAPABILITY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      caps.push(cap);
    }
  }
  return caps;
}

export function getCapabilityBadge(cap: string) {
  switch (cap) {
    case "thinking":
      return { label: "推理", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" };
    case "vision":
      return { label: "视觉", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" };
    case "long_context":
      return { label: "长文", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" };
    case "fast":
      return { label: "快速", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
    default:
      return { label: cap, className: "" };
  }
}

export async function fetchModelsFromProviderApi(
  baseUrl: string,
  apiKey: string,
  providerType: string,
  providerId?: string,
): Promise<{ models: string[]; modelGroups: Record<string, string[]> }> {
  const endpoint = `${getBackendBaseURL()}/api/user/fetch-provider-models`;
  const response = await fetchWithAuth(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      base_url: baseUrl,
      api_key: apiKey,
      provider_type: providerType,
      provider_id: providerId,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `请求失败 (${response.status})`);
  }
  const data = (await response.json()) as {
    models: string[];
    model_groups?: Record<string, string[]>;
  };
  return {
    models: data.models ?? [],
    modelGroups: data.model_groups ?? {},
  };
}
