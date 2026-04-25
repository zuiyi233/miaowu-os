import type { AIMessage } from "@langchain/langgraph-sdk";

import type { Translations } from "../i18n";
import {
  getToolCalls,
  hasToolCalls,
  type NormalizedToolCall,
} from "../messages/utils";

export function explainLastToolCall(message: AIMessage, t: Translations) {
  if (hasToolCalls(message)) {
    const toolCalls = getToolCalls(message);
    const lastToolCall = toolCalls[toolCalls.length - 1];
    if (!lastToolCall) {
      return t.common.thinking;
    }
    return explainToolCall(lastToolCall, t);
  }
  return t.common.thinking;
}

export function explainToolCall(
  toolCall: Pick<NormalizedToolCall, "name" | "args">,
  t: Translations,
) {
  if (toolCall.name === "web_search" || toolCall.name === "image_search") {
    const query =
      typeof toolCall.args.query === "string" ? toolCall.args.query : "";
    return t.toolCalls.searchFor(query);
  } else if (toolCall.name === "web_fetch") {
    return t.toolCalls.viewWebPage;
  } else if (toolCall.name === "present_files") {
    return t.toolCalls.presentFiles;
  } else if (toolCall.name === "write_todos") {
    return t.toolCalls.writeTodos;
  } else if (typeof toolCall.args.description === "string") {
    return toolCall.args.description;
  } else {
    return t.toolCalls.useTool(toolCall.name);
  }
}
