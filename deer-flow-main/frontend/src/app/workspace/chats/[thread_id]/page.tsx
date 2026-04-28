"use client";

import type { Message } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Phase2StatusBar } from "@/components/novel/Phase2StatusBar";
import { ArtifactTrigger } from "@/components/workspace/artifacts";
import {
  ChatBox,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { ExportTrigger } from "@/components/workspace/export-trigger";
import { InputBox } from "@/components/workspace/input-box";
import {
  MessageList,
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM,
} from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { TokenUsageIndicator } from "@/components/workspace/token-usage-indicator";
import { Welcome } from "@/components/workspace/welcome";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { useNotification } from "@/core/notification/hooks";
import { buildPhase2SnapshotFromThread } from "@/core/novel/phase2-status";
import { useThreadSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

type ClarificationAction = {
  label: string;
  value: string;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost" | "link";
};

type PendingClarification = {
  question: string;
  actions: ClarificationAction[];
};

function mapQuickActionToUserText(value: string): string {
  const normalized = value.trim();
  switch (normalized) {
    case "__enter_execution_mode__":
    case "enter_execution_mode":
      return "进入执行模式";
    case "__confirm_action__":
    case "confirm_action":
      return "确认执行";
    case "__cancel_action__":
    case "cancel_action":
      return "取消";
    default:
      return normalized;
  }
}

function isOptimisticHumanMessage(message: Message): boolean {
  if (message.type !== "human") {
    return false;
  }
  return typeof message.id === "string" && message.id.startsWith("opt-human-");
}

function extractPendingClarification(messages: Message[]): PendingClarification | null {
  let clarificationIndex = -1;
  let clarificationMessage: Message | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate?.type === "tool" && candidate?.name === "ask_clarification") {
      clarificationIndex = i;
      clarificationMessage = candidate;
      break;
    }
  }
  if (!clarificationMessage || clarificationIndex < 0) {
    return null;
  }

  const hasUserResponded = messages
    .slice(clarificationIndex + 1)
    .some(
      (message) =>
        message.type === "human" &&
        !isOptimisticHumanMessage(message) &&
        (textOfMessage(message)?.trim().length ?? 0) > 0,
    );
  if (hasUserResponded) {
    return null;
  }

  const additionalKwargs =
    clarificationMessage.additional_kwargs &&
    typeof clarificationMessage.additional_kwargs === "object" &&
    !Array.isArray(clarificationMessage.additional_kwargs)
      ? (clarificationMessage.additional_kwargs as Record<string, unknown>)
      : null;

  const clarificationPayload =
    additionalKwargs?.clarification &&
    typeof additionalKwargs.clarification === "object" &&
    !Array.isArray(additionalKwargs.clarification)
      ? (additionalKwargs.clarification as Record<string, unknown>)
      : null;

  const question = typeof clarificationPayload?.question === "string"
    ? clarificationPayload.question.trim()
    : (textOfMessage(clarificationMessage)?.trim() ?? "");

  const quickActionsRaw = Array.isArray(clarificationPayload?.quick_actions)
    ? clarificationPayload.quick_actions
    : [];
  const parsedActions = quickActionsRaw
    .map<ClarificationAction | null>((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const value = typeof record.value === "string" ? record.value.trim() : "";
      if (!label || !value) {
        return null;
      }
      return {
        label,
        value,
        variant:
          label.includes("取消") || value.includes("cancel") || value.includes("取消")
            ? "outline"
            : "default",
      };
    })
    .filter((item): item is ClarificationAction => item !== null);

  const fallbackActions: ClarificationAction[] =
    parsedActions.length > 0
      ? parsedActions
      : question && (question.includes("确认") || question.includes("执行"))
        ? [
            { label: "开启执行模式并执行", value: "__enter_execution_mode__", variant: "default" as const },
            { label: "仅执行本次", value: "__confirm_action__", variant: "outline" as const },
            { label: "取消", value: "取消", variant: "outline" as const },
          ]
        : [];

  if (!question || fallbackActions.length === 0) {
    return null;
  }
  return {
    question,
    actions: fallbackActions,
  };
}

export default function ChatPage() {
  const { t } = useI18n();
  const [showFollowups, setShowFollowups] = useState(false);
  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } =
    useThreadChat();
  const [settings, setSettings] = useThreadSettings(threadId);
  const [mounted, setMounted] = useState(false);
  const { tokenUsageEnabled } = useModels();
  useSpecificChatMode();

  useEffect(() => {
    setMounted(true);
  }, []);

  const { showNotification } = useNotification();

  const [thread, sendMessage, isUploading] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: {
      ...settings.context,
      moduleId: "chat-main",
      module_id: "chat-main",
    },
    isMock,
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      setIsNewThread(false);
      // ! Important: Never use next.js router for navigation in this case, otherwise it will cause the thread to re-mount and lose all states. Use native history API instead.
      history.replaceState(null, "", `/workspace/chats/${createdThreadId}`);
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  useEffect(() => {
    // Fallback: in some runtime combinations, onCreated may not fire even
    // after the first user message is already in the thread state (optimistic
    // or streamed). Ensure we leave the "new thread" centered layout to avoid
    // messages rendering behind the composer.
    if (!isNewThread || thread.messages.length === 0) {
      return;
    }

    setIsNewThread(false);
    history.replaceState(null, "", `/workspace/chats/${threadId}`);
  }, [isNewThread, setIsNewThread, thread.messages.length, threadId]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      void sendMessage(threadId, message, {
        moduleId: "chat-main",
        module_id: "chat-main",
      });
    },
    [sendMessage, threadId],
  );
  const handleQuickReply = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      void sendMessage(
        threadId,
        {
          text: normalized,
          files: [],
        },
        {
          moduleId: "chat-main",
          module_id: "chat-main",
        },
      );
    },
    [sendMessage, threadId],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const messageListPaddingBottom = showFollowups
    ? MESSAGE_LIST_DEFAULT_PADDING_BOTTOM +
      MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM
    : undefined;
  const phase2Snapshot = useMemo(
    () => buildPhase2SnapshotFromThread(thread.values, thread.error),
    [thread.error, thread.values],
  );
  const qualityReportHref = useMemo(() => {
    if (phase2Snapshot?.reportUrl) {
      return phase2Snapshot.reportUrl;
    }
    if (!phase2Snapshot?.novelId) {
      return undefined;
    }
    return `/workspace/novel/${encodeURIComponent(phase2Snapshot.novelId)}/quality`;
  }, [phase2Snapshot?.novelId, phase2Snapshot?.reportUrl]);
  const pendingClarification = useMemo(
    () => extractPendingClarification(thread.messages),
    [thread.messages],
  );

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center px-4",
              isNewThread
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            <div className="flex w-full items-center text-sm font-medium">
              <ThreadTitle threadId={threadId} thread={thread} />
            </div>
            <div className="flex items-center gap-2">
              <TokenUsageIndicator
                enabled={tokenUsageEnabled}
                messages={thread.messages}
              />
              <ExportTrigger threadId={threadId} />
              <ArtifactTrigger />
            </div>
          </header>
          <main className="flex min-h-0 max-w-full grow flex-col">
            {!isNewThread && phase2Snapshot ? (
              <div className="px-4 pt-14 pb-2">
                <Phase2StatusBar
                  snapshot={phase2Snapshot}
                  reportHref={qualityReportHref}
                  compact
                />
              </div>
            ) : null}
            <div className="flex size-full justify-center">
              <MessageList
                className={cn(
                  "size-full",
                  !isNewThread && !phase2Snapshot && "pt-10",
                  !isNewThread && phase2Snapshot && "pt-2",
                )}
                threadId={threadId}
                thread={thread}
                paddingBottom={messageListPaddingBottom}
                tokenUsageEnabled={tokenUsageEnabled}
              />
            </div>
            <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "relative w-full",
                  isNewThread && "-translate-y-[calc(50vh-96px)]",
                  isNewThread
                    ? "max-w-(--container-width-sm)"
                    : "max-w-(--container-width-md)",
                )}
              >
                <div className="absolute -top-4 right-0 left-0 z-0">
                  <div className="absolute right-0 bottom-0 left-0">
                    <TodoList
                      className="bg-background/5"
                      todos={thread.values?.todos ?? []}
                      hidden={
                        !thread.values?.todos ||
                        thread.values.todos.length === 0
                      }
                    />
                  </div>
                </div>
                {mounted ? (
                  <InputBox
                    className={cn("bg-background/5 w-full -translate-y-4")}
                    isNewThread={isNewThread}
                    threadId={threadId}
                    autoFocus={isNewThread}
                    status={
                      thread.error
                        ? "error"
                        : thread.isLoading
                          ? "streaming"
                          : "ready"
                    }
                    context={settings.context}
                    extraHeader={
                      isNewThread && <Welcome mode={settings.context.mode} />
                    }
                    disabled={
                      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
                      isUploading
                    }
                    onContextChange={(context) =>
                      setSettings("context", context)
                    }
                    onFollowupsVisibilityChange={setShowFollowups}
                    pendingClarification={pendingClarification}
                    onPendingClarificationAction={(value) =>
                      handleQuickReply(mapQuickActionToUserText(value))
                    }
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className={cn(
                      "bg-background/5 h-32 w-full -translate-y-4 rounded-2xl border",
                    )}
                  />
                )}
                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
