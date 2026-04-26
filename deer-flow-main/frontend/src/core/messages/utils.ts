import type { AIMessage, Message } from "@langchain/langgraph-sdk";

interface GenericMessageGroup<T = string> {
  type: T;
  id: string | undefined;
  messages: Message[];
}

interface HumanMessageGroup extends GenericMessageGroup<"human"> {}

interface AssistantProcessingGroup extends GenericMessageGroup<"assistant:processing"> {}

interface AssistantMessageGroup extends GenericMessageGroup<"assistant"> {}

interface AssistantPresentFilesGroup extends GenericMessageGroup<"assistant:present-files"> {}

interface AssistantClarificationGroup extends GenericMessageGroup<"assistant:clarification"> {}

interface AssistantSubagentGroup extends GenericMessageGroup<"assistant:subagent"> {}

type MessageGroup =
  | HumanMessageGroup
  | AssistantProcessingGroup
  | AssistantMessageGroup
  | AssistantPresentFilesGroup
  | AssistantClarificationGroup
  | AssistantSubagentGroup;

export interface NormalizedToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

function parseToolCallCollection(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === "object") {
    return [raw];
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return parseToolCallCollection(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseToolCallArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { raw: trimmed };
    }
  }

  return {};
}

function normalizeToolCall(raw: unknown): NormalizedToolCall | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;

  let name = "";
  let argsSource: unknown = record.args;

  if (typeof record.name === "string" && record.name.trim()) {
    name = record.name.trim();
  }

  if (!name) {
    const functionCall = record.function;
    if (
      functionCall &&
      typeof functionCall === "object" &&
      !Array.isArray(functionCall)
    ) {
      const fn = functionCall as Record<string, unknown>;
      if (typeof fn.name === "string" && fn.name.trim()) {
        name = fn.name.trim();
        argsSource = fn.arguments;
      }
    }
  }

  if (!name) {
    const fallbackName = record.tool_name;
    if (typeof fallbackName === "string" && fallbackName.trim()) {
      name = fallbackName.trim();
    }
  }

  if (argsSource === undefined && "arguments" in record) {
    argsSource = record.arguments;
  }
  if (argsSource === undefined && "input" in record) {
    argsSource = record.input;
  }

  if (!name) {
    return null;
  }

  return {
    id,
    name,
    args: parseToolCallArgs(argsSource),
  };
}

function extractAdditionalKwargsToolCalls(message: Message): NormalizedToolCall[] {
  if (message.type !== "ai") {
    return [];
  }

  const additionalKwargs =
    message.additional_kwargs &&
    typeof message.additional_kwargs === "object" &&
    !Array.isArray(message.additional_kwargs)
      ? (message.additional_kwargs as Record<string, unknown>)
      : null;

  if (!additionalKwargs) {
    return [];
  }

  const rawToolCalls = [
    additionalKwargs.tool_calls,
    additionalKwargs.raw_tool_calls,
    additionalKwargs.openai_tool_calls,
    additionalKwargs.function_calls,
  ];

  const normalized = rawToolCalls
    .flatMap((candidate) => parseToolCallCollection(candidate))
    .map((item) => normalizeToolCall(item))
    .filter((item): item is NormalizedToolCall => item !== null);

  return normalized;
}

export function getToolCalls(message: Message): NormalizedToolCall[] {
  if (message.type !== "ai") {
    return [];
  }

  const direct = parseToolCallCollection(message.tool_calls)
    .map((item) => normalizeToolCall(item))
    .filter((item): item is NormalizedToolCall => item !== null);

  if (direct.length > 0) {
    return direct;
  }

  return extractAdditionalKwargsToolCalls(message);
}

export function groupMessages<T>(
  messages: Message[],
  mapper: (group: MessageGroup) => T,
): T[] {
  if (messages.length === 0) {
    return [];
  }

  const groups: MessageGroup[] = [];
  const pendingToolMessagesByCallId = new Map<string, Message[]>();
  const orphanToolMessagesWithoutCallId: Message[] = [];

  // Returns the last group if it can still accept tool messages
  // (i.e. it's an in-flight processing group, not a terminal human/assistant group).
  function lastOpenGroup() {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.type !== "human" &&
      last.type !== "assistant" &&
      last.type !== "assistant:clarification"
    ) {
      return last;
    }
    return null;
  }

  for (const message of messages) {
    if (isHiddenFromUIMessage(message)) {
      continue;
    }

    if (message.name === "todo_reminder") {
      continue;
    }

    if (message.type === "human") {
      groups.push({ id: message.id, type: "human", messages: [message] });
      continue;
    }

    if (message.type === "tool") {
      if (isClarificationToolMessage(message)) {
        // Add to the preceding processing group to preserve tool-call association,
        // then also open a standalone clarification group for prominent display.
        lastOpenGroup()?.messages.push(message);
        groups.push({
          id: message.id,
          type: "assistant:clarification",
          messages: [message],
        });
      } else {
        const open = lastOpenGroup();
        if (open) {
          open.messages.push(message);
        } else {
          const callId =
            typeof message.tool_call_id === "string"
              ? message.tool_call_id
              : undefined;
          if (callId) {
            const queued = pendingToolMessagesByCallId.get(callId) ?? [];
            queued.push(message);
            pendingToolMessagesByCallId.set(callId, queued);
          } else {
            orphanToolMessagesWithoutCallId.push(message);
          }
        }
      }
      continue;
    }

    if (message.type === "ai") {
      if (hasPresentFiles(message)) {
        groups.push({
          id: message.id,
          type: "assistant:present-files",
          messages: [message],
        });
      } else if (hasSubagent(message)) {
        groups.push({
          id: message.id,
          type: "assistant:subagent",
          messages: [message],
        });
      } else if (hasReasoning(message) || hasToolCalls(message)) {
        const lastGroup = groups[groups.length - 1];
        // Accumulate consecutive intermediate AI messages into one processing group.
        let processingGroup: AssistantProcessingGroup;
        if (lastGroup?.type !== "assistant:processing") {
          processingGroup = {
            id: message.id,
            type: "assistant:processing",
            messages: [message],
          };
          groups.push(processingGroup);
        } else {
          lastGroup.messages.push(message);
          processingGroup = lastGroup;
        }

        const toolCalls = getToolCalls(message);
        for (const toolCall of toolCalls) {
          if (!toolCall.id) continue;
          const queued = pendingToolMessagesByCallId.get(toolCall.id);
          if (!queued || queued.length === 0) continue;
          processingGroup.messages.push(...queued);
          pendingToolMessagesByCallId.delete(toolCall.id);
        }
      }

      // Not an else-if: a message with reasoning + content (but no tool calls) goes
      // into the processing group above AND gets its own assistant bubble here.
      if (hasContent(message) && !hasToolCalls(message)) {
        groups.push({ id: message.id, type: "assistant", messages: [message] });
      }
    }
  }

  // Flush unmatched tool messages so they remain visible instead of being dropped.
  for (const queuedMessages of pendingToolMessagesByCallId.values()) {
    if (queuedMessages.length === 0) continue;
    groups.push({
      id: queuedMessages[0]?.id,
      type: "assistant",
      messages: queuedMessages,
    });
  }
  for (const toolMessage of orphanToolMessagesWithoutCallId) {
    groups.push({
      id: toolMessage.id,
      type: "assistant",
      messages: [toolMessage],
    });
  }

  return groups
    .map(mapper)
    .filter((result) => result !== undefined && result !== null) as T[];
}

export function extractTextFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return (
      splitInlineReasoningFromAIMessage(message)?.content ??
      message.content.trim()
    );
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g;

function splitInlineReasoning(content: string) {
  const reasoningParts: string[] = [];
  const cleaned = content
    .replace(THINK_TAG_RE, (_, reasoning: string) => {
      const normalized = reasoning.trim();
      if (normalized) {
        reasoningParts.push(normalized);
      }
      return "";
    })
    .trim();

  return {
    content: cleaned,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
  };
}

function splitInlineReasoningFromAIMessage(message: Message) {
  if (message.type !== "ai" || typeof message.content !== "string") {
    return null;
  }
  return splitInlineReasoning(message.content);
}

export function extractContentFromMessage(message: Message) {
  if (typeof message.content === "string") {
    return (
      splitInlineReasoningFromAIMessage(message)?.content ??
      message.content.trim()
    );
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((content) => {
        switch (content.type) {
          case "text":
            return content.text;
          case "image_url":
            const imageURL = extractURLFromImageURLContent(content.image_url);
            return `![image](${imageURL})`;
          default:
            return "";
        }
      })
      .join("\n")
      .trim();
  }
  return "";
}

export function extractReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai") {
    return null;
  }
  if (
    message.additional_kwargs &&
    "reasoning_content" in message.additional_kwargs
  ) {
    return message.additional_kwargs.reasoning_content as string | null;
  }
  if (Array.isArray(message.content)) {
    const part = message.content[0];
    if (part && "thinking" in part) {
      return part.thinking as string;
    }
  }
  if (typeof message.content === "string") {
    return splitInlineReasoning(message.content).reasoning;
  }
  return null;
}

export function removeReasoningContentFromMessage(message: Message) {
  if (message.type !== "ai" || !message.additional_kwargs) {
    return;
  }
  delete message.additional_kwargs.reasoning_content;
}

export function extractURLFromImageURLContent(
  content:
    | string
    | {
        url: string;
      },
) {
  if (typeof content === "string") {
    return content;
  }
  return content.url;
}

export function hasContent(message: Message) {
  if (typeof message.content === "string") {
    return (
      (
        splitInlineReasoningFromAIMessage(message)?.content ??
        message.content.trim()
      ).length > 0
    );
  }
  if (Array.isArray(message.content)) {
    return message.content.length > 0;
  }
  return false;
}

export function hasReasoning(message: Message) {
  if (message.type !== "ai") {
    return false;
  }
  if (typeof message.additional_kwargs?.reasoning_content === "string") {
    return true;
  }
  if (Array.isArray(message.content)) {
    const part = message.content[0];
    // Compatible with the Anthropic gateway
    return (part as unknown as { type: "thinking" })?.type === "thinking";
  }
  if (typeof message.content === "string") {
    return splitInlineReasoning(message.content).reasoning !== null;
  }
  return false;
}

export function hasToolCalls(message: Message) {
  return message.type === "ai" && getToolCalls(message).length > 0;
}

export function hasPresentFiles(message: Message) {
  return (
    message.type === "ai" &&
    getToolCalls(message).some((toolCall) => toolCall.name === "present_files")
  );
}

export function isClarificationToolMessage(message: Message) {
  return message.type === "tool" && message.name === "ask_clarification";
}

export function extractPresentFilesFromMessage(message: Message) {
  if (message.type !== "ai" || !hasPresentFiles(message)) {
    return [];
  }
  const files: string[] = [];
  for (const toolCall of getToolCalls(message)) {
    if (
      toolCall.name === "present_files" &&
      Array.isArray(toolCall.args.filepaths)
    ) {
      files.push(...(toolCall.args.filepaths as string[]));
    }
  }
  return files;
}

export function hasSubagent(message: AIMessage) {
  for (const toolCall of getToolCalls(message)) {
    if (toolCall.name === "task") {
      return true;
    }
  }
  return false;
}

export function findToolCallResult(toolCallId: string, messages: Message[]) {
  for (const message of messages) {
    if (message.type === "tool" && message.tool_call_id === toolCallId) {
      const content = extractTextFromMessage(message);
      if (content) {
        return content;
      }
    }
  }
  return undefined;
}

export function isHiddenFromUIMessage(message: Message) {
  return message.additional_kwargs?.hide_from_ui === true;
}

/**
 * Represents a file stored in message additional_kwargs.files.
 * Used for optimistic UI (uploading state) and structured file metadata.
 */
export interface FileInMessage {
  filename: string;
  size: number; // bytes
  path?: string; // virtual path, may not be set during upload
  status?: "uploading" | "uploaded";
}

/**
 * Strip <uploaded_files> tag from message content.
 * Returns the content with the tag removed.
 */
export function stripUploadedFilesTag(content: string): string {
  return content
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>/g, "")
    .trim();
}

export function parseUploadedFiles(content: string): FileInMessage[] {
  // Match <uploaded_files>...</uploaded_files> tag
  const uploadedFilesRegex = /<uploaded_files>([\s\S]*?)<\/uploaded_files>/;
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
  const match = content.match(uploadedFilesRegex);

  if (!match) {
    return [];
  }

  const uploadedFilesContent = match[1];

  // Check if it's "No files have been uploaded yet."
  if (uploadedFilesContent?.includes("No files have been uploaded yet.")) {
    return [];
  }

  // Check if the backend reported no new files were uploaded in this message
  if (uploadedFilesContent?.includes("(empty)")) {
    return [];
  }

  // Parse file list
  // Format: - filename (size)\n  Path: /path/to/file
  const fileRegex = /- ([^\n(]+)\s*\(([^)]+)\)\s*\n\s*Path:\s*([^\n]+)/g;
  const files: FileInMessage[] = [];
  let fileMatch;

  while ((fileMatch = fileRegex.exec(uploadedFilesContent ?? "")) !== null) {
    files.push({
      filename: fileMatch[1].trim(),
      size: parseInt(fileMatch[2].trim(), 10) ?? 0,
      path: fileMatch[3].trim(),
    });
  }

  return files;
}
