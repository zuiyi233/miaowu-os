import { CHAT_SUGGESTIONS_MODULE_ID } from "@/core/ai/feature-routing";

import type { Model } from "@/core/models/types";

export type FollowupsVisibilityParams = {
  disabled?: boolean;
  isNewThread?: boolean;
  hasPendingClarification: boolean;
  followupsHidden: boolean;
  followupsLoading: boolean;
  followupsCount: number;
};

export function shouldShowFollowups({
  disabled,
  isNewThread,
  hasPendingClarification,
  followupsHidden,
  followupsLoading,
  followupsCount,
}: FollowupsVisibilityParams): boolean {
  return (
    !disabled &&
    !isNewThread &&
    !hasPendingClarification &&
    !followupsHidden &&
    (followupsLoading || followupsCount > 0)
  );
}

export type FollowupSuggestionMessage = {
  role: "user" | "assistant";
  content: string;
};

export type FollowupSuggestionsRequestBody = {
  messages: FollowupSuggestionMessage[];
  n: number;
  module_id: typeof CHAT_SUGGESTIONS_MODULE_ID;
};

export function buildFollowupSuggestionsRequestBody(
  messages: FollowupSuggestionMessage[],
  n = 3,
): FollowupSuggestionsRequestBody {
  return {
    messages,
    n,
    module_id: CHAT_SUGGESTIONS_MODULE_ID,
  };
}

export type ModelSelectionResult = {
  modelName: string | null;
  changed: boolean;
};

export function resolveNextModelSelection(
  currentModelName: string | undefined,
  models: Model[],
  defaultModelName: string | null,
): ModelSelectionResult {
  if (models.length === 0) {
    return { modelName: null, changed: false };
  }
  const currentModel = models.find((m) => m.name === currentModelName);
  if (currentModel) {
    return { modelName: currentModelName!, changed: false };
  }
  const fallbackModel = defaultModelName
    ? models.find((m) => m.name === defaultModelName) ?? models[0]
    : models[0];
  return { modelName: fallbackModel!.name, changed: true };
}

export function resolveModuleId(
  agentName?: string,
): "chat-main" | "agent-chat" {
  return agentName ? "agent-chat" : "chat-main";
}
