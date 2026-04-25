import type { AIMessage, Message } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { env } from "@/env";

import { getAPIClient } from "../api";
import { getBackendBaseURL } from "../config";
import { useI18n } from "../i18n/hooks";
import type { FileInMessage } from "../messages/utils";
import type { LocalSettings } from "../settings";
import { useUpdateSubtask } from "../tasks/context";
import type { UploadedFileInfo } from "../uploads";
import { promptInputFilePartToFile, uploadFiles } from "../uploads";

import type { AgentThread, AgentThreadState } from "./types";
import { withOptimisticMessages } from "./utils";

export type ToolEndEvent = {
  name: string;
  data: unknown;
};

export type ThreadStreamOptions = {
  threadId?: string | null | undefined;
  context: LocalSettings["context"];
  isMock?: boolean;
  onStart?: (threadId: string) => void;
  onFinish?: (state: AgentThreadState) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
};

type SendMessageOptions = {
  additionalKwargs?: Record<string, unknown>;
};

function normalizeStoredRunId(runId: string | null): string | null {
  if (!runId) {
    return null;
  }

  const trimmed = runId.trim();
  if (!trimmed) {
    return null;
  }

  const queryIndex = trimmed.indexOf("?");
  if (queryIndex >= 0) {
    const params = new URLSearchParams(trimmed.slice(queryIndex + 1));
    const queryRunId = params.get("run_id")?.trim();
    if (queryRunId) {
      return queryRunId;
    }
  }

  const pathWithoutQueryOrHash = trimmed.split(/[?#]/, 1)[0]?.trim() ?? "";
  if (!pathWithoutQueryOrHash) {
    return null;
  }

  const runsMarker = "/runs/";
  const runsIndex = pathWithoutQueryOrHash.lastIndexOf(runsMarker);
  if (runsIndex >= 0) {
    const runIdAfterMarker = pathWithoutQueryOrHash
      .slice(runsIndex + runsMarker.length)
      .split("/", 1)[0]
      ?.trim();
    if (runIdAfterMarker) {
      return runIdAfterMarker;
    }
    return null;
  }

  const segments = pathWithoutQueryOrHash
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.at(-1) ?? null;
}

function getRunMetadataStorage(): {
  getItem(key: `lg:stream:${string}`): string | null;
  setItem(key: `lg:stream:${string}`, value: string): void;
  removeItem(key: `lg:stream:${string}`): void;
} {
  return {
    getItem(key) {
      const normalized = normalizeStoredRunId(
        window.sessionStorage.getItem(key),
      );
      if (normalized) {
        window.sessionStorage.setItem(key, normalized);
        return normalized;
      }
      window.sessionStorage.removeItem(key);
      return null;
    },
    setItem(key, value) {
      const normalized = normalizeStoredRunId(value);
      if (normalized) {
        window.sessionStorage.setItem(key, normalized);
        return;
      }
      window.sessionStorage.removeItem(key);
    },
    removeItem(key) {
      window.sessionStorage.removeItem(key);
    },
  };
}

function getStreamErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const nestedError = Reflect.get(error, "error");
    if (nestedError instanceof Error && nestedError.message.trim()) {
      return nestedError.message;
    }
    if (typeof nestedError === "string" && nestedError.trim()) {
      return nestedError;
    }
  }
  return "Request failed.";
}

const STREAM_SUBMIT_MAX_ATTEMPTS = 10;
const STREAM_SUBMIT_RETRY_BASE_DELAY_MS = 3000;

function parseErrorStatusCode(error: unknown): number | null {
  const parseStatus = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  if (!error || typeof error !== "object") {
    return null;
  }

  const statusCandidates = [
    Reflect.get(error, "status"),
    Reflect.get(error, "statusCode"),
    Reflect.get(Reflect.get(error, "response"), "status"),
    Reflect.get(Reflect.get(error, "cause"), "status"),
  ];
  for (const candidate of statusCandidates) {
    const parsed = parseStatus(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const nested = Reflect.get(error, "error");
  if (nested && typeof nested === "object") {
    const nestedCandidates = [
      Reflect.get(nested, "status"),
      Reflect.get(nested, "statusCode"),
      Reflect.get(Reflect.get(nested, "response"), "status"),
      Reflect.get(Reflect.get(nested, "cause"), "status"),
    ];
    for (const candidate of nestedCandidates) {
      const parsed = parseStatus(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return null;
}

function isRetryableSubmitError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }

  const statusCode = parseErrorStatusCode(error);
  if (statusCode !== null) {
    if (statusCode === 408 || statusCode === 409 || statusCode === 425) {
      return true;
    }
    if (statusCode === 429) {
      return true;
    }
    if (statusCode >= 500) {
      return true;
    }
    return false;
  }

  const errorObject = error && typeof error === "object" ? error : null;
  const nestedErrorObject =
    errorObject && typeof Reflect.get(errorObject, "error") === "object"
      ? (Reflect.get(errorObject, "error") as object)
      : null;
  const causeErrorObject =
    errorObject && typeof Reflect.get(errorObject, "cause") === "object"
      ? (Reflect.get(errorObject, "cause") as object)
      : null;
  const codeCandidates = [
    errorObject ? Reflect.get(errorObject, "code") : undefined,
    nestedErrorObject ? Reflect.get(nestedErrorObject, "code") : undefined,
    causeErrorObject ? Reflect.get(causeErrorObject, "code") : undefined,
  ];
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNABORTED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "ERR_NETWORK",
    "ERR_CONNECTION_RESET",
    "ERR_CONNECTION_ABORTED",
    "ERR_CONNECTION_CLOSED",
    "ERR_INTERNET_DISCONNECTED",
  ]);
  for (const candidate of codeCandidates) {
    if (typeof candidate === "string" && retryableCodes.has(candidate)) {
      return true;
    }
  }

  const message = getStreamErrorMessage(error).toLowerCase();
  const retryablePatterns = [
    "network",
    "network error",
    "disconnected",
    "disconnect",
    "failed to fetch",
    "fetch failed",
    "timeout",
    "timed out",
    "temporarily unavailable",
    "connection reset",
    "connection closed",
    "connection aborted",
    "gateway timeout",
    "stream timed out",
    "socket closed",
    "econnreset",
    "econnaborted",
    "etimedout",
    "socket hang up",
    "断联",
    "断开",
    "网络波动",
    "连接中断",
    "连接超时",
  ];
  return retryablePatterns.some((pattern) => message.includes(pattern));
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeAgentThreadState(
  values: Partial<AgentThreadState> | null | undefined,
): AgentThreadState {
  const valuesCandidate = values ?? {};
  return {
    ...(valuesCandidate as AgentThreadState),
    title:
      typeof valuesCandidate.title === "string" ? valuesCandidate.title : "",
    messages: Array.isArray(valuesCandidate.messages)
      ? valuesCandidate.messages
      : [],
    artifacts: Array.isArray(valuesCandidate.artifacts)
      ? valuesCandidate.artifacts
      : [],
  };
}

export function useThreadStream({
  threadId,
  context,
  isMock,
  onStart,
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const { t } = useI18n();
  // Track the thread ID that is currently streaming to handle thread changes during streaming
  const [onStreamThreadId, setOnStreamThreadId] = useState(() => threadId);
  // Ref to track current thread ID across async callbacks without causing re-renders,
  // and to allow access to the current thread id in onUpdateEvent
  const threadIdRef = useRef<string | null>(threadId ?? null);
  const startedRef = useRef(false);
  const createNovelProgressRef = useRef<Map<string, string>>(new Map());

  const listeners = useRef({
    onStart,
    onFinish,
    onToolEnd,
  });

  // Keep listeners ref updated with latest callbacks
  useEffect(() => {
    listeners.current = { onStart, onFinish, onToolEnd };
  }, [onStart, onFinish, onToolEnd]);

  useEffect(() => {
    const normalizedThreadId = threadId ?? null;
    if (!normalizedThreadId) {
      // Reset when the UI moves back to a brand new unsaved thread.
      startedRef.current = false;
      setOnStreamThreadId(normalizedThreadId);
    } else {
      setOnStreamThreadId(normalizedThreadId);
    }
    threadIdRef.current = normalizedThreadId;
    createNovelProgressRef.current.clear();
  }, [threadId]);

  const _handleOnStart = useCallback((id: string) => {
    if (!startedRef.current) {
      listeners.current.onStart?.(id);
      startedRef.current = true;
    }
  }, []);

  const handleStreamStart = useCallback(
    (_threadId: string) => {
      threadIdRef.current = _threadId;
      _handleOnStart(_threadId);
    },
    [_handleOnStart],
  );

  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();
  const isGatewayCompatRuntime = Boolean(
    env.NEXT_PUBLIC_LANGGRAPH_BASE_URL?.includes("/api"),
  );
  const runMetadataStorageRef = useRef<
    ReturnType<typeof getRunMetadataStorage> | undefined
  >(undefined);

  if (
    typeof window !== "undefined" &&
    runMetadataStorageRef.current === undefined
  ) {
    runMetadataStorageRef.current = getRunMetadataStorage();
  }

  const thread = useStream<AgentThreadState>({
    client: getAPIClient(isMock),
    assistantId: "lead_agent",
    threadId: onStreamThreadId,
    reconnectOnMount: runMetadataStorageRef.current
      ? () => runMetadataStorageRef.current!
      : false,
    // Keep history enabled because the stream object exposes `history` getter;
    // LangGraph SDK throws when that getter is touched while disabled.
    // Restrict to a small page to reduce overhead.
    fetchStateHistory: { limit: 1 },
    onCreated(meta) {
      handleStreamStart(meta.thread_id);
      setOnStreamThreadId(meta.thread_id);
      if (context.agent_name && !isMock) {
        void getAPIClient()
          .threads.update(meta.thread_id, {
            metadata: { agent_name: context.agent_name },
          })
          .catch((error) => {
            console.warn(
              "[threads] Failed to persist agent_name metadata for thread",
              meta.thread_id,
              error,
            );
          });
      }
    },
    ...(isGatewayCompatRuntime
      ? {}
      : {
          onLangChainEvent(event: {
            event: string;
            name: string;
            data: unknown;
          }) {
            if (event.event === "on_tool_end") {
              listeners.current.onToolEnd?.({
                name: event.name,
                data: event.data,
              });
            }
          },
        }),
    onUpdateEvent(data) {
      const updates: Array<Partial<AgentThreadState> | null> = Object.values(
        data || {},
      );
      for (const update of updates) {
        if (update && "title" in update && update.title) {
          void queryClient.setQueriesData(
            {
              queryKey: ["threads", "search"],
              exact: false,
            },
            (oldData: Array<AgentThread> | undefined) => {
              return oldData?.map((t) => {
                if (t.thread_id === threadIdRef.current) {
                  return {
                    ...t,
                    values: {
                      ...t.values,
                      title: update.title,
                    },
                  };
                }
                return t;
              });
            },
          );
        }
      }
    },
    onCustomEvent(event: unknown) {
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "task_running"
      ) {
        const e = event as {
          type: "task_running";
          task_id: string;
          message: AIMessage;
        };
        updateSubtask({ id: e.task_id, latestMessage: e.message });
        return;
      }

      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "create_novel_progress"
      ) {
        const e = event as {
          type: "create_novel_progress";
          tool_call_id?: string;
          stage?: string;
          status?: string;
          message?: string;
        };
        const stage =
          typeof e.stage === "string" && e.stage.trim()
            ? e.stage.trim()
            : "unknown_stage";
        const status =
          typeof e.status === "string" && e.status.trim()
            ? e.status.trim()
            : "running";
        const message =
          typeof e.message === "string" && e.message.trim()
            ? e.message.trim()
            : `create_novel ${stage} (${status})`;
        const fallbackThreadScope =
          typeof threadIdRef.current === "string" && threadIdRef.current.trim()
            ? threadIdRef.current.trim()
            : "default-thread";
        const fallbackToolId = `${fallbackThreadScope}:${stage}`;
        const normalizedToolCallId =
          typeof e.tool_call_id === "string" && e.tool_call_id.trim()
            ? e.tool_call_id.trim()
            : fallbackToolId;
        const toastId = `create-novel-progress:${normalizedToolCallId}`;
        const dedupeKey = `${stage}:${status}:${message}`;
        if (createNovelProgressRef.current.get(toastId) === dedupeKey) {
          return;
        }
        createNovelProgressRef.current.set(toastId, dedupeKey);

        if (status === "failed") {
          toast.error(message, { id: toastId });
        } else if (status === "completed" && stage === "completed") {
          toast.success(message, { id: toastId });
        } else {
          toast(message, { id: toastId });
        }
        return;
      }

      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "llm_retry" &&
        "message" in event &&
        typeof event.message === "string" &&
        event.message.trim()
      ) {
        const e = event as { type: "llm_retry"; message: string };
        toast(e.message);
      }
    },
    onError(error) {
      setOptimisticMessages([]);
      createNovelProgressRef.current.clear();
      toast.error(getStreamErrorMessage(error));
    },
  });

  // Optimistic messages shown before the server stream responds
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const sendInFlightRef = useRef(false);
  // Track message count before sending so we know when server has responded
  const prevMsgCountRef = useRef(thread.messages.length);
  const wasLoadingRef = useRef(false);

  // Reset thread-local pending UI state when switching between threads so
  // optimistic messages and in-flight guards do not leak across chat views.
  useEffect(() => {
    startedRef.current = false;
    sendInFlightRef.current = false;
    prevMsgCountRef.current = 0;
    wasLoadingRef.current = false;
    createNovelProgressRef.current.clear();
    setOptimisticMessages([]);
    setIsUploading(false);
  }, [threadId]);

  useEffect(() => {
    if (thread.isLoading) {
      wasLoadingRef.current = true;
      return;
    }

    if (!wasLoadingRef.current) {
      return;
    }

    wasLoadingRef.current = false;
    listeners.current.onFinish?.(
      normalizeAgentThreadState(thread.values as Partial<AgentThreadState>),
    );
    createNovelProgressRef.current.clear();
    void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
  }, [queryClient, thread.isLoading, thread.values]);

  // Clear optimistic when server messages arrive (count increases)
  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      thread.messages.length > prevMsgCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [thread.messages.length, optimisticMessages.length]);

  const sendMessage = useCallback(
    async (
      threadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
      options?: SendMessageOptions,
    ) => {
      if (sendInFlightRef.current) {
        return;
      }
      sendInFlightRef.current = true;

      const text = message.text.trim();

      // Capture current count before showing optimistic messages
      prevMsgCountRef.current = thread.messages.length;

      // Build optimistic files list with uploading status
      const optimisticFiles: FileInMessage[] = (message.files ?? []).map(
        (f) => ({
          filename: f.filename ?? "",
          size: 0,
          status: "uploading" as const,
        }),
      );

      const hideFromUI = options?.additionalKwargs?.hide_from_ui === true;
      const optimisticAdditionalKwargs = {
        ...options?.additionalKwargs,
        ...(optimisticFiles.length > 0 ? { files: optimisticFiles } : {}),
      };

      const newOptimistic: Message[] = [];
      if (!hideFromUI) {
        newOptimistic.push({
          type: "human",
          id: `opt-human-${Date.now()}`,
          content: text ? [{ type: "text", text }] : "",
          additional_kwargs: optimisticAdditionalKwargs,
        });
      }

      if (optimisticFiles.length > 0 && !hideFromUI) {
        // Mock AI message while files are being uploaded
        newOptimistic.push({
          type: "ai",
          id: `opt-ai-${Date.now()}`,
          content: t.uploads.uploadingFiles,
          additional_kwargs: { element: "task" },
        });
      }
      setOptimisticMessages(newOptimistic);

      // Only fire onStart immediately for an existing persisted thread.
      // Brand-new chats should wait for onCreated(meta.thread_id) so URL sync
      // uses the real server-generated thread id.
      if (threadIdRef.current) {
        _handleOnStart(threadId);
      }

      let uploadedFileInfo: UploadedFileInfo[] = [];

      try {
        // Upload files first if any
        if (message.files && message.files.length > 0) {
          setIsUploading(true);
          try {
            const filePromises = message.files.map((fileUIPart) =>
              promptInputFilePartToFile(fileUIPart),
            );

            const conversionResults = await Promise.all(filePromises);
            const files = conversionResults.filter(
              (file): file is File => file !== null,
            );
            const failedConversions = conversionResults.length - files.length;

            if (failedConversions > 0) {
              throw new Error(
                `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
              );
            }

            if (!threadId) {
              throw new Error("Thread is not ready for file upload.");
            }

            if (files.length > 0) {
              const uploadResponse = await uploadFiles(threadId, files);
              uploadedFileInfo = uploadResponse.files;

              // Update optimistic human message with uploaded status + paths
              const uploadedFiles: FileInMessage[] = uploadedFileInfo.map(
                (info) => ({
                  filename: info.filename,
                  size: info.size,
                  path: info.virtual_path,
                  status: "uploaded" as const,
                }),
              );
              setOptimisticMessages((messages) => {
                if (messages.length > 1 && messages[0]) {
                  const humanMessage: Message = messages[0];
                  return [
                    {
                      ...humanMessage,
                      additional_kwargs: { files: uploadedFiles },
                    },
                    ...messages.slice(1),
                  ];
                }
                return messages;
              });
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to upload files.";
            toast.error(errorMessage);
            setOptimisticMessages([]);
            throw error;
          } finally {
            setIsUploading(false);
          }
        }

        // Build files metadata for submission (included in additional_kwargs)
        const filesForSubmit: FileInMessage[] = uploadedFileInfo.map(
          (info) => ({
            filename: info.filename,
            size: info.size,
            path: info.virtual_path,
            status: "uploaded" as const,
          }),
        );

        const submitPayload: Parameters<typeof thread.submit>[0] = {
          messages: [
            {
              type: "human",
              content: [
                {
                  type: "text" as const,
                  text,
                },
              ],
              additional_kwargs: {
                ...options?.additionalKwargs,
                ...(filesForSubmit.length > 0
                  ? { files: filesForSubmit }
                  : {}),
              },
            },
          ],
        };

        const submitOptions: Parameters<typeof thread.submit>[1] = {
          threadId: threadId,
          streamSubgraphs: true,
          streamResumable: true,
          config: {
            recursion_limit: 1000,
          },
          context: {
            ...extraContext,
            ...context,
            thinking_enabled: context.mode !== "flash",
            is_plan_mode: context.mode === "pro" || context.mode === "ultra",
            subagent_enabled: context.mode === "ultra",
            reasoning_effort:
              context.reasoning_effort ??
              (context.mode === "ultra"
                ? "high"
                : context.mode === "pro"
                  ? "medium"
                  : context.mode === "thinking"
                    ? "low"
                    : undefined),
            thread_id: threadId,
          },
        };

        for (
          let attempt = 1;
          attempt <= STREAM_SUBMIT_MAX_ATTEMPTS;
          attempt += 1
        ) {
          try {
            await thread.submit(submitPayload, submitOptions);
            break;
          } catch (error) {
            const canRetry =
              isRetryableSubmitError(error) &&
              attempt < STREAM_SUBMIT_MAX_ATTEMPTS;
            if (!canRetry) {
              throw error;
            }

            const delayMs = STREAM_SUBMIT_RETRY_BASE_DELAY_MS * attempt;
            toast(
              `网络波动，${Math.round(delayMs / 1000)} 秒后自动重试（第 ${attempt + 1}/${STREAM_SUBMIT_MAX_ATTEMPTS} 次）`,
            );
            await waitMs(delayMs);
          }
        }

        void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      } catch (error) {
        setOptimisticMessages([]);
        setIsUploading(false);
        throw error;
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [thread, _handleOnStart, t.uploads.uploadingFiles, context, queryClient],
  );

  // Merge optimistic messages without spreading `thread`, because `useStream`
  // exposes getter properties (e.g. `history`) that can throw when disabled.
  const mergedThread = withOptimisticMessages(thread, optimisticMessages);

  return [mergedThread, sendMessage, isUploading] as const;
}

export function useThreads(
  params: Parameters<ThreadsClient["search"]>[0] = {
    limit: 50,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "updated_at", "values", "metadata", "context"],
  },
) {
  const apiClient = getAPIClient();
  return useQuery<AgentThread[]>({
    queryKey: ["threads", "search", params],
    queryFn: async () => {
      const maxResults = params.limit;
      const initialOffset = params.offset ?? 0;
      const DEFAULT_PAGE_SIZE = 50;

      // Preserve prior semantics: if a non-positive limit is explicitly provided,
      // delegate to a single search call with the original parameters.
      if (maxResults !== undefined && maxResults <= 0) {
        const response =
          await apiClient.threads.search<AgentThreadState>(params);
        return response as AgentThread[];
      }

      const pageSize =
        typeof maxResults === "number" && maxResults > 0
          ? Math.min(DEFAULT_PAGE_SIZE, maxResults)
          : DEFAULT_PAGE_SIZE;

      const threads: AgentThread[] = [];
      let offset = initialOffset;

      while (true) {
        if (typeof maxResults === "number" && threads.length >= maxResults) {
          break;
        }

        const currentLimit =
          typeof maxResults === "number"
            ? Math.min(pageSize, maxResults - threads.length)
            : pageSize;

        if (typeof maxResults === "number" && currentLimit <= 0) {
          break;
        }

        const response = (await apiClient.threads.search<AgentThreadState>({
          ...params,
          limit: currentLimit,
          offset,
        })) as AgentThread[];

        threads.push(...response);

        if (response.length < currentLimit) {
          break;
        }

        offset += response.length;
      }

      return threads;
    },
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await apiClient.threads.delete(threadId);

      const response = await fetch(
        `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ detail: "Failed to delete local thread data." }));
        throw new Error(error.detail ?? "Failed to delete local thread data.");
      }
    },
    onSuccess(_, { threadId }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread> | undefined) => {
          if (oldData == null) {
            return oldData;
          }
          return oldData.filter((t) => t.thread_id !== threadId);
        },
      );
    },
    onSettled() {
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.map((t) => {
            if (t.thread_id === threadId) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });
}
