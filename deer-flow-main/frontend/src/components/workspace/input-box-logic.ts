import { CHAT_SUGGESTIONS_MODULE_ID } from "@/core/ai/feature-routing";

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
