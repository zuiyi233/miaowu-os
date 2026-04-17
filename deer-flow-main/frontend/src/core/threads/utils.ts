import type { Message } from "@langchain/langgraph-sdk";

import type { AgentThread, AgentThreadContext } from "./types";

type ThreadRouteTarget =
  | string
  | {
      thread_id: string;
      context?: Pick<AgentThreadContext, "agent_name"> | null;
      metadata?: Record<string, unknown> | null;
    };

export function pathOfThread(
  thread: ThreadRouteTarget,
  context?: Pick<AgentThreadContext, "agent_name"> | null,
) {
  const threadId = typeof thread === "string" ? thread : thread.thread_id;
  let agentName: string | undefined;
  if (typeof thread === "string") {
    agentName = context?.agent_name;
  } else {
    agentName = thread.context?.agent_name;
    if (!agentName) {
      const metaAgent = thread.metadata?.agent_name;
      if (typeof metaAgent === "string") {
        agentName = metaAgent;
      }
    }
  }

  return agentName
    ? `/workspace/agents/${encodeURIComponent(agentName)}/chats/${threadId}`
    : `/workspace/chats/${threadId}`;
}

export function textOfMessage(message: Message) {
  if (typeof message.content === "string") {
    return message.content;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text") {
        return part.text;
      }
    }
  }
  return null;
}

export function titleOfThread(thread: AgentThread) {
  return thread.values?.title ?? "Untitled";
}

/**
 * Add optimistic messages without eagerly reading every enumerable property on
 * the stream object (which may include getter properties that can throw).
 */
export function withOptimisticMessages<TThread extends { messages: Message[] }>(
  thread: TThread,
  optimisticMessages: Message[],
): TThread {
  if (optimisticMessages.length === 0) {
    return thread;
  }

  const shadowThread = Object.create(thread) as TThread;
  Object.defineProperty(shadowThread, "messages", {
    configurable: true,
    enumerable: true,
    value: [...thread.messages, ...optimisticMessages],
    writable: false,
  });
  return shadowThread;
}
