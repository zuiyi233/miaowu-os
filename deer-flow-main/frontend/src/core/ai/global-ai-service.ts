import { getBackendBaseURL } from "@/core/config";

import { useAiProviderStore, type AiProviderConfig } from "./ai-provider-store";
import {
  loadFeatureRoutingState,
  normalizeFeatureRoutingState,
  resolveModuleRoutingTarget,
  saveFeatureRoutingState,
  switchModuleToBackupWithLog,
} from "./feature-routing";
import { putUserAiSettings } from "./useAiSettingsApi";

function getApiBaseUrl() {
  return getBackendBaseURL();
}

export interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface DomainToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

export interface SessionBrief {
  mode: "normal" | "create" | "manage";
  status: string;
  active_project?: {
    id: string | null;
    title: string | null;
  };
  missing_field?: string | null;
  fields?: Record<string, unknown>;
  pending_action?: {
    action: string;
    entity: string;
    target: string;
    missing_fields: string[];
  } | null;
  idempotency_key?: string;
}

export interface AiStructuredResponse {
  content: string;
  tool_calls?: DomainToolCall[];
  novel?: Record<string, unknown>;
  session?: SessionBrief;
  context?: Record<string, unknown>;
}

export interface AiRequestOptions {
  messages: AiMessage[];
  context?: Record<string, unknown>;
  novelId?: string;
  moduleId?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  providerId?: string;
}

export interface AiStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullText: string, structured?: AiStructuredResponse) => void;
  onError?: (error: Error) => void;
  onAbort?: () => void;
  onStructured?: (data: AiStructuredResponse) => void;
  abortSignal?: AbortSignal;
}

export interface AiServiceContext {
  provider: AiProviderConfig | null;
  providers: AiProviderConfig[];
  enableStreamMode: boolean;
  globalSystemPrompt: string;
  requestTimeout: number;
  maxRetries: number;
}

interface AiErrorInfo {
  code: string;
  message: string;
  provider?: string;
  retryable: boolean;
  severity: "low" | "medium" | "high" | "critical";
  suggestion?: string;
}

type ErrorCode =
  | "NO_PROVIDER"
  | "NO_API_KEY"
  | "NO_MODELS"
  | "NETWORK_ERROR"
  | "RATE_LIMIT"
  | "AUTH_FAILED"
  | "SERVER_ERROR"
  | "TIMEOUT";

export class AiServiceError extends Error {
  constructor(
    message: string,
    public info: AiErrorInfo
  ) {
    super(message);
    this.name = "AiServiceError";
  }
}

const ERROR_CATALOG: Record<ErrorCode, AiErrorInfo> = {
  NO_PROVIDER: {
    code: "NO_PROVIDER",
    message: "请先在设置中配置AI供应商",
    retryable: false,
    severity: "high",
    suggestion: "请在设置 > AI供应商 中添加并激活一个AI服务提供商",
  },
  NO_API_KEY: {
    code: "NO_API_KEY",
    message: "API密钥未配置",
    retryable: false,
    severity: "high",
    suggestion: "请在供应商配置中填写有效的API密钥",
  },
  NO_MODELS: {
    code: "NO_MODELS",
    message: "未配置可用模型",
    retryable: false,
    severity: "medium",
    suggestion: "请在供应商配置中添加至少一个模型名称",
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    message: "网络连接失败",
    retryable: true,
    severity: "medium",
    suggestion: "请检查网络连接或尝试切换到其他供应商",
  },
  RATE_LIMIT: {
    code: "RATE_LIMIT",
    message: "API调用频率超限",
    retryable: true,
    severity: "medium",
    suggestion: "请稍后重试，或考虑升级API套餐",
  },
  AUTH_FAILED: {
    code: "AUTH_FAILED",
    message: "API认证失败",
    retryable: false,
    severity: "high",
    suggestion: "请检查API密钥是否正确，或联系服务提供商",
  },
  SERVER_ERROR: {
    code: "SERVER_ERROR",
    message: "服务器内部错误",
    retryable: true,
    severity: "high",
    suggestion: "服务可能暂时不可用，请稍后重试",
  },
  TIMEOUT: {
    code: "TIMEOUT",
    message: "请求超时",
    retryable: true,
    severity: "medium",
    suggestion: "可以尝试增加超时时间或简化请求内容",
  },
};

const CHAT_RETRY_BASE_DELAY_MS = 3000;
const STREAM_CHUNK_TIMEOUT_CEILING_MS = 90_000;

function mergeAbortSignals(
  signals: ReadonlyArray<AbortSignal | null | undefined>
): AbortSignal | undefined {
  const validSignals = signals.filter(
    (signal): signal is AbortSignal => Boolean(signal)
  );
  if (validSignals.length === 0) return undefined;
  if (validSignals.length === 1) return validSignals[0];

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(validSignals);
  }

  const fallbackController = new AbortController();
  const onAbort = () => fallbackController.abort();
  for (const signal of validSignals) {
    if (signal.aborted) {
      fallbackController.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return fallbackController.signal;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

type SseErrorPayload = {
  error: unknown;
  message?: unknown;
  [key: string]: unknown;
};

function buildSseError(payload: SseErrorPayload): Error {
  const rawError = payload.error;
  let message = "";

  if (typeof rawError === "string") {
    message = rawError;
  } else if (rawError && typeof rawError === "object") {
    const nestedMessage = (rawError as Record<string, unknown>).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      message = nestedMessage;
    } else {
      try {
        message = JSON.stringify(rawError);
      } catch {
        message = "Unknown SSE error payload";
      }
    }
  }

  if (!message.trim()) {
    const fallbackMessage = payload.message;
    if (typeof fallbackMessage === "string" && fallbackMessage.trim()) {
      message = fallbackMessage;
    }
  }

  const error = new Error(message.trim() || "SSE stream returned an error");
  Object.assign(error, { details: payload });
  return error;
}

function isSseErrorPayload(value: unknown): value is SseErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "error")
  );
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const signal = mergeAbortSignals([controller.signal, options.signal]);
    const response = await fetch(url, { ...options, signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function normalizeMaxRetries(maxRetries: number): number {
  if (!Number.isFinite(maxRetries)) {
    return 0;
  }
  const normalized = Math.floor(maxRetries);
  if (normalized < 0) {
    return 0;
  }
  return Math.min(normalized, 20);
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number,
  timeoutMs: number,
  retryDelayMs: number
): Promise<Response> {
  let lastError: Error | null = null;
  const effectiveRetries = normalizeMaxRetries(retries);

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.ok) return response;

      const errorBody = await response.text().catch(() => "");
      const errorInfo = classifyHttpError(response.status, errorBody);
      throw new AiServiceError(
        `API error: ${response.status} ${response.statusText}`,
        errorInfo
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isAbortError(error)) {
        throw lastError;
      }

      if (error instanceof AiServiceError && !error.info.retryable) {
        throw error;
      }

      if (attempt < effectiveRetries) {
        const retryIndex = attempt + 1;
        const backoffDelay = retryDelayMs * retryIndex;
        console.warn(
          `AI请求失败 (尝试 ${attempt + 1}/${effectiveRetries + 1}): ${lastError.message}. ${backoffDelay}ms后重试...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, backoffDelay)
        );
      }
    }
  }

  throw lastError ?? new Error("Unknown error after retries");
}

const HARD_AUTH_PATTERNS = [
  "invalid api key",
  "invalid_api_key",
  "api key invalid",
  "api key not found",
  "incorrect api key",
  "api key disabled",
  "api key expired",
  "account suspended",
  "account deactivated",
  "account banned",
  "key revoked",
  "token revoked",
];

function isHardAuthError(errorBody: string): boolean {
  const lowered = errorBody.toLowerCase();
  return HARD_AUTH_PATTERNS.some((p) => lowered.includes(p));
}

function classifyHttpError(
  status: number,
  errorBody: string
): AiErrorInfo {
  switch (status) {
    case 400:
      return {
        code: "BAD_REQUEST",
        message: "请求参数错误",
        retryable: false,
        severity: "medium",
        suggestion: "请检查请求参数是否正确",
      };
    case 401:
      return {
        code: "AUTH_FAILED",
        message: errorBody || ERROR_CATALOG.AUTH_FAILED.message || "认证失败",
        retryable: false,
        severity: "high",
        suggestion: ERROR_CATALOG.AUTH_FAILED.suggestion,
      };
    case 403:
      if (isHardAuthError(errorBody)) {
        return {
          code: "AUTH_FAILED",
          message: errorBody || ERROR_CATALOG.AUTH_FAILED.message || "认证失败",
          retryable: false,
          severity: "high",
          suggestion: ERROR_CATALOG.AUTH_FAILED.suggestion,
        };
      }
      return {
        code: "TRANSIENT_AUTH",
        message: errorBody || "认证暂时失败",
        retryable: true,
        severity: "medium",
        suggestion: "可能是网络波动导致的临时认证失败，将自动重试",
      };
    case 402:
      if (isHardAuthError(errorBody)) {
        return {
          code: "AUTH_FAILED",
          message: errorBody || "支付验证失败",
          retryable: false,
          severity: "high",
          suggestion: ERROR_CATALOG.AUTH_FAILED.suggestion,
        };
      }
      return {
        code: "TRANSIENT_PAYMENT",
        message: errorBody || "支付服务暂时不可用",
        retryable: true,
        severity: "medium",
        suggestion: "可能是网络波动导致的临时问题，将自动重试",
      };
    case 404:
      return {
        code: "TRANSIENT_NOT_FOUND",
        message: errorBody || "服务暂时不可达",
        retryable: true,
        severity: "medium",
        suggestion: "可能是网络波动导致的临时问题，将自动重试",
      };
    case 419:
      return {
        code: "TRANSIENT_AUTH_TIMEOUT",
        message: errorBody || "认证会话超时",
        retryable: true,
        severity: "medium",
        suggestion: "可能是网络波动导致的临时问题，将自动重试",
      };
    case 429:
      return {
        code: "RATE_LIMIT",
        message: errorBody || ERROR_CATALOG.RATE_LIMIT.message || "频率限制",
        retryable: true,
        severity: "medium",
        suggestion: ERROR_CATALOG.RATE_LIMIT.suggestion,
      };
    case 500:
    case 502:
    case 503:
    case 504:
      return {
        code: "SERVER_ERROR",
        message: `服务器错误 (${status})`,
        // 504 on chat requests often means the backend already spent time
        // processing the prompt. Retrying blindly can create duplicate chat
        // requests and visible retry storms, so treat it as terminal here.
        retryable: status === 504 ? false : true,
        severity: "high",
        suggestion: ERROR_CATALOG.SERVER_ERROR.suggestion,
      };
    default:
      return {
        code: `HTTP_${status}`,
        message: errorBody || `HTTP错误: ${status}`,
        retryable: status >= 500,
        severity: status >= 500 ? "high" : "medium",
      };
  }
}

function validateProviderConfig(provider: AiProviderConfig | null | undefined): void {
  if (!provider) {
    throw new AiServiceError(
      "No active AI provider configured",
      ERROR_CATALOG.NO_PROVIDER
    );
  }

  if (!provider.models || provider.models.length === 0) {
    throw new AiServiceError(
      "No models configured",
      {
        code: "NO_MODELS",
        message: `供应商 "${provider.name}" 未配置可用模型`,
        provider: provider.name,
        retryable: false,
        severity: "medium",
        suggestion: ERROR_CATALOG.NO_MODELS?.suggestion,
      }
    );
  }
}

export function mergeSystemPromptIntoMessages(
  messages: AiMessage[],
  globalSystemPrompt: string
): AiMessage[] {
  if (!globalSystemPrompt.trim()) {
    return messages;
  }

  const hasSystemMessage = messages.some((msg) => msg.role === "system");
  if (hasSystemMessage) {
    return messages.map((msg) =>
      msg.role === "system"
        ? {
            ...msg,
            content: `${globalSystemPrompt}\n\n${msg.content}`,
          }
        : msg
    );
  }

  return [
    {
      role: "system",
      content: globalSystemPrompt,
    },
    ...messages,
  ];
}

export function buildChatRequestContext(
  context: Record<string, unknown> | undefined,
  novelId: string | undefined,
  moduleId?: string
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {
    ...(context ?? {}),
  };

  if (novelId) {
    merged.novelId = novelId;
    merged.novel_id = novelId;
  }

  if (moduleId) {
    merged.moduleId = moduleId;
    merged.module_id = moduleId;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function resolveNonStreamContent(data: Record<string, unknown>): string {
  const messageObj =
    data.message && typeof data.message === "object"
      ? (data.message as Record<string, unknown>)
      : undefined;
  const directContent =
    typeof data.content === "string" ? data.content : undefined;
  const messageContent =
    typeof messageObj?.content === "string"
      ? messageObj.content
      : undefined;
  return directContent ?? messageContent ?? "";
}

function parseDomainToolArgs(raw: unknown): Record<string, unknown> {
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

function pushToolCallsFromAdditionalKwargs(
  owner: Record<string, unknown> | null | undefined,
  pushToolCalls: (candidate: unknown) => void
): void {
  if (!owner) {
    return;
  }
  const additionalKwargs =
    owner.additional_kwargs &&
    typeof owner.additional_kwargs === "object" &&
    !Array.isArray(owner.additional_kwargs)
      ? (owner.additional_kwargs as Record<string, unknown>)
      : null;
  if (!additionalKwargs) {
    return;
  }

  pushToolCalls(additionalKwargs.tool_calls);
  pushToolCalls(additionalKwargs.raw_tool_calls);
  pushToolCalls(additionalKwargs.openai_tool_calls);
  pushToolCalls(additionalKwargs.function_calls);
}

function normalizeDomainToolCall(value: unknown): DomainToolCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  let name = "";
  let argsSource: unknown = record.args;

  if (typeof record.name === "string" && record.name.trim()) {
    name = record.name.trim();
  }

  if (!name) {
    const fn = record.function;
    if (fn && typeof fn === "object" && !Array.isArray(fn)) {
      const fnRecord = fn as Record<string, unknown>;
      if (typeof fnRecord.name === "string" && fnRecord.name.trim()) {
        name = fnRecord.name.trim();
        argsSource = fnRecord.arguments;
      }
    }
  }

  if (!name && typeof record.tool_name === "string" && record.tool_name.trim()) {
    name = record.tool_name.trim();
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
    name,
    args: parseDomainToolArgs(argsSource),
    id,
  };
}

function extractStructuredToolCalls(data: Record<string, unknown>): DomainToolCall[] {
  const candidates: unknown[] = [];
  const pushToolCalls = (candidate: unknown) => {
    candidates.push(...parseToolCallCollection(candidate));
  };

  pushToolCalls(data.tool_calls);
  pushToolCalls(data.raw_tool_calls);
  pushToolCalls(data.function_calls);
  pushToolCallsFromAdditionalKwargs(data, pushToolCalls);

  const messageRecord =
    data.message && typeof data.message === "object"
      ? (data.message as Record<string, unknown>)
      : null;
  if (messageRecord) {
    pushToolCalls(messageRecord.tool_calls);
    pushToolCalls(messageRecord.raw_tool_calls);
    pushToolCalls(messageRecord.function_calls);
    pushToolCallsFromAdditionalKwargs(messageRecord, pushToolCalls);
  }

  const deltaRecord =
    data.delta && typeof data.delta === "object"
      ? (data.delta as Record<string, unknown>)
      : null;
  if (deltaRecord) {
    pushToolCalls(deltaRecord.tool_calls);
    pushToolCalls(deltaRecord.raw_tool_calls);
    pushToolCalls(deltaRecord.function_calls);
    pushToolCallsFromAdditionalKwargs(deltaRecord, pushToolCalls);
  }

  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (firstChoice && typeof firstChoice === "object") {
    const firstChoiceRecord = firstChoice as Record<string, unknown>;
    pushToolCalls(firstChoiceRecord.tool_calls);
    pushToolCalls(firstChoiceRecord.raw_tool_calls);
    pushToolCalls(firstChoiceRecord.function_calls);
    pushToolCallsFromAdditionalKwargs(firstChoiceRecord, pushToolCalls);

    const choiceMessage =
      firstChoiceRecord.message && typeof firstChoiceRecord.message === "object"
        ? (firstChoiceRecord.message as Record<string, unknown>)
        : null;
    if (choiceMessage) {
      pushToolCalls(choiceMessage.tool_calls);
      pushToolCalls(choiceMessage.raw_tool_calls);
      pushToolCalls(choiceMessage.function_calls);
      pushToolCallsFromAdditionalKwargs(choiceMessage, pushToolCalls);
    }

    const choiceDelta =
      firstChoiceRecord.delta && typeof firstChoiceRecord.delta === "object"
        ? (firstChoiceRecord.delta as Record<string, unknown>)
        : null;
    if (choiceDelta) {
      pushToolCalls(choiceDelta.tool_calls);
      pushToolCalls(choiceDelta.raw_tool_calls);
      pushToolCalls(choiceDelta.function_calls);
      pushToolCallsFromAdditionalKwargs(choiceDelta, pushToolCalls);
    }
  }

  const normalized = candidates
    .map((candidate) => normalizeDomainToolCall(candidate))
    .filter((candidate): candidate is DomainToolCall => candidate !== null);
  const deduped: DomainToolCall[] = [];
  const dedupeSet = new Set<string>();
  for (const call of normalized) {
    const argsKey = (() => {
      try {
        return JSON.stringify(call.args);
      } catch {
        return "[unserializable_args]";
      }
    })();
    const dedupeKey = `${call.id}|${call.name}|${argsKey}`;
    if (dedupeSet.has(dedupeKey)) {
      continue;
    }
    dedupeSet.add(dedupeKey);
    deduped.push(call);
  }

  return deduped;
}

function _extractStructuredResponse(data: Record<string, unknown>): AiStructuredResponse {
  const messageObj =
    data.message && typeof data.message === "object"
      ? (data.message as Record<string, unknown>)
      : undefined;
  const contentValue =
    typeof data.content === "string"
      ? data.content
      : typeof messageObj?.content === "string"
      ? messageObj.content
      : "";
  const result: AiStructuredResponse = {
    content: contentValue,
  };

  const toolCalls = extractStructuredToolCalls(data);
  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }

  if (data.novel && typeof data.novel === "object") {
    result.novel = data.novel as Record<string, unknown>;
  }

  if (data.session && typeof data.session === "object") {
    result.session = data.session as SessionBrief;
  }

  if (data.context && typeof data.context === "object") {
    result.context = data.context as Record<string, unknown>;
  }

  return result;
}

function updateStoreFeatureRoutingState(nextState: ReturnType<typeof normalizeFeatureRoutingState>): void {
  useAiProviderStore.setState((state) => ({
    effective: {
      ...state.effective,
      featureRoutingSettings: nextState,
    },
    draft: {
      ...state.draft,
      featureRoutingSettings: nextState,
    },
  }));
}

function syncFeatureRoutingStateToServerBestEffort(
  nextState: ReturnType<typeof normalizeFeatureRoutingState>
): void {
  void putUserAiSettings({
    feature_routing_settings: nextState,
  }).catch((err) => {
    console.warn("[FeatureRouting] 回写后端 feature_routing_settings 失败:", err);
  });
}

export class GlobalAiService {
  private abortController: AbortController | null = null;

  private getContext(serviceContext?: AiServiceContext): AiServiceContext {
    if (serviceContext) {
      return serviceContext;
    }

    console.warn(
      "⚠️ GlobalAiService: 未提供 serviceContext 参数，正在从 store 获取配置。" +
      "建议显式传入配置以提高性能和可测试性。"
    );

    const store = useAiProviderStore.getState();

    return {
      provider: store.getEffectiveActiveProvider(),
      providers: store.effective.providers,
      enableStreamMode: store.effective.enableStreamMode,
      globalSystemPrompt: store.effective.globalSystemPrompt,
      requestTimeout: store.effective.requestTimeout,
      maxRetries: store.effective.maxRetries,
    };
  }

  async chat(
    options: AiRequestOptions,
    callbacks?: AiStreamCallbacks,
    serviceContext?: AiServiceContext
  ): Promise<string> {
    if (!serviceContext) {
      try {
        await useAiProviderStore.getState().ensureHydrated();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "AI settings hydration failed";
        throw new AiServiceError("AI settings hydration failed", {
          code: "SERVER_ERROR",
          message: `AI 设置加载失败：${message}`,
          retryable: false,
          severity: "critical",
        });
      }
    }
    const ctx = this.getContext(serviceContext);
    const hasExplicitProvider = Boolean(options.providerId);
    const hasExplicitModel = Boolean(options.model);
    const contextModuleId =
      typeof options.context?.moduleId === "string"
        ? options.context.moduleId
        : typeof options.context?.module_id === "string"
        ? options.context.module_id
        : undefined;
    const moduleId = options.moduleId ?? contextModuleId;

    const serverFeatureRoutingState =
      moduleId ? useAiProviderStore.getState().effective.featureRoutingSettings : null;
    const routingState = moduleId
      ? normalizeFeatureRoutingState(
          serverFeatureRoutingState ?? loadFeatureRoutingState(ctx.providers),
          ctx.providers
        )
      : null;
    const routedTarget =
      moduleId && !hasExplicitProvider && !hasExplicitModel && routingState
        ? resolveModuleRoutingTarget(routingState, moduleId)
        : null;
    const routedModelTarget = routedTarget?.target ?? null;

    const provider =
      (options.providerId
        ? ctx.providers.find((p) => p.id === options.providerId)
        : undefined) ??
      (routedModelTarget
        ? ctx.providers.find((p) => p.id === routedModelTarget.providerId)
        : undefined) ??
      ctx.provider;

    validateProviderConfig(provider);

    const {
      stream = ctx.enableStreamMode,
      temperature = provider?.temperature ?? 0.7,
      maxTokens = provider?.maxTokens ?? 2000,
      model = routedModelTarget?.model ?? provider?.models[0],
    } = options;

    this.abortController = new AbortController();

    const signal =
      mergeAbortSignals([
        this.abortController.signal,
        callbacks?.abortSignal,
      ]) ?? this.abortController.signal;

    try {
      const endpoint = `${getApiBaseUrl()}/api/ai/chat`;
      const messages = mergeSystemPromptIntoMessages(
        [...options.messages],
        ctx.globalSystemPrompt
      );
      const requestContext = buildChatRequestContext(
        options.context,
        options.novelId,
        moduleId
      );

      const callChatApi = async (
        targetProvider: AiProviderConfig,
        targetModel: string
      ): Promise<Response> => {
        const requestBody = {
          messages,
          stream,
          context: requestContext,
          provider_config: {
            provider: targetProvider.provider,
            base_url: targetProvider.baseUrl,
            model_name: targetModel,
            temperature,
            max_tokens: maxTokens,
          },
        };

        return fetchWithRetry(
          endpoint,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal,
          },
          ctx.maxRetries,
          ctx.requestTimeout,
          CHAT_RETRY_BASE_DELAY_MS
        );
      };

      let response: Response;
      try {
        response = await callChatApi(provider!, model!);
      } catch (primaryError) {
        const canAutoFailover =
          Boolean(moduleId) &&
          Boolean(routingState) &&
          Boolean(routedTarget) &&
          routedTarget?.moduleRoute.currentMode === "primary" &&
          routedTarget?.moduleRoute.autoFailover &&
          Boolean(routedTarget?.moduleRoute.backupTarget);

        if (!canAutoFailover || isAbortError(primaryError)) {
          throw primaryError;
        }

        const backupTarget = routedTarget.moduleRoute.backupTarget!;
        const backupProvider = ctx.providers.find(
          (item) => item.id === backupTarget.providerId
        );

        if (!backupProvider) {
          throw primaryError;
        }

        validateProviderConfig(backupProvider);

        const errorMessage =
          primaryError instanceof Error
            ? primaryError.message
            : String(primaryError);
        console.warn(
          `[FeatureRouting] 模块 ${moduleId} 主链路失败，切换到备用模型重试: ${errorMessage}`
        );

        response = await callChatApi(backupProvider, backupTarget.model);

        const reason = `主模型请求失败，自动切换备用模型：${errorMessage}`;
        const switchedState = switchModuleToBackupWithLog(
          routingState!,
          moduleId!,
          reason,
          true
        );
        const normalizedSwitchedState = normalizeFeatureRoutingState(switchedState, ctx.providers);
        saveFeatureRoutingState(normalizedSwitchedState);
        updateStoreFeatureRoutingState(normalizedSwitchedState);
        syncFeatureRoutingStateToServerBestEffort(normalizedSwitchedState);
      }

      if (!stream) {
        const data = await response.json() as Record<string, unknown>;
        const content = resolveNonStreamContent(data);
        const structured = _extractStructuredResponse(data);
        if (structured && (structured.tool_calls || structured.session || structured.novel)) {
          callbacks?.onStructured?.(structured);
        }
        callbacks?.onComplete?.(content, structured);
        return content;
      }

      const streamChunkTimeoutMs = Math.max(
        15_000,
        Math.min(ctx.requestTimeout, STREAM_CHUNK_TIMEOUT_CEILING_MS)
      );
      return await this.processStreamResponse(
        response,
        callbacks,
        streamChunkTimeoutMs
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        callbacks?.onAbort?.();
        return "";
      }

      const err =
        error instanceof Error ? error : new Error(String(error));
      callbacks?.onError?.(err);
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  private async processStreamResponse(
    response: Response,
    callbacks?: AiStreamCallbacks,
    timeoutMs = 30000
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body available");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";
    let lastStructured: AiStructuredResponse | undefined;

    const readWithTimeout = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`SSE stream timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    };

    const processLine = (rawLine: string) => {
      const line = rawLine.trimEnd();
      if (!line.startsWith("data: ")) {
        return;
      }

      const data = line.slice(6);
      if (data === "[DONE]") {
        return;
      }

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;

        if (isSseErrorPayload(parsed)) {
          throw buildSseError(parsed);
        }

        const structuredCandidate = _extractStructuredResponse(parsed);
        if (
          (structuredCandidate.tool_calls &&
            structuredCandidate.tool_calls.length > 0) ||
          structuredCandidate.session ||
          structuredCandidate.novel ||
          structuredCandidate.context
        ) {
          lastStructured = structuredCandidate;
          callbacks?.onStructured?.(structuredCandidate);
        }

        const deltaRecord =
          parsed.delta && typeof parsed.delta === "object"
            ? (parsed.delta as Record<string, unknown>)
            : undefined;
        const firstChoice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
        const firstChoiceRecord =
          firstChoice && typeof firstChoice === "object"
            ? (firstChoice as Record<string, unknown>)
            : undefined;
        const choiceDeltaRecord =
          firstChoiceRecord?.delta && typeof firstChoiceRecord.delta === "object"
            ? (firstChoiceRecord.delta as Record<string, unknown>)
            : undefined;

        const contentCandidate =
          parsed.content ?? deltaRecord?.content ?? choiceDeltaRecord?.content;
        const content =
          typeof contentCandidate === "string" ? contentCandidate : "";
        if (content) {
          fullText += content;
          callbacks?.onChunk?.(content);
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          if (data.trim()) {
            fullText += data;
            callbacks?.onChunk?.(data);
          }
          return;
        }

        throw error;
      }
    };

    try {
      while (true) {
        const { done, value } = await readWithTimeout();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
        }
      }

      if (buffer.trim()) {
        processLine(buffer);
      }

      callbacks?.onComplete?.(fullText, lastStructured);
      return fullText;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async testConnection(
    providerId: string,
    serviceContext?: AiServiceContext
  ): Promise<{
    success: boolean;
    message: string;
    latency?: number;
  }> {
    if (!serviceContext) {
      try {
        await useAiProviderStore.getState().ensureHydrated();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "AI settings hydration failed";
        return {
          success: false,
          message: `AI 设置加载失败：${message}`,
        };
      }
    }
    const ctx = this.getContext(serviceContext);
    const provider = ctx.providers.find((p) => p.id === providerId);

    validateProviderConfig(provider);

    const startTime = Date.now();

    try {
      const response = await fetchWithTimeout(
        `${getApiBaseUrl()}/api/ai/test-connection`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: provider!.provider,
            base_url: provider!.baseUrl,
            model: provider!.models[0],
          }),
        },
        10000
      );

      const latency = Date.now() - startTime;

      if (response.ok) {
        return {
          success: true,
          message: `连接成功 (${latency}ms)`,
          latency,
        };
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        typeof errorData?.message === "string"
          ? errorData.message
          : undefined;
      return {
        success: false,
        message: errorMessage ?? `连接失败: ${response.status}`,
        latency,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "网络连接失败",
        latency: Date.now() - startTime,
      };
    }
  }

  getAvailableProviders(serviceContext?: AiServiceContext): AiProviderConfig[] {
    const ctx = this.getContext(serviceContext);
    return ctx.providers;
  }

  getActiveProviderConfig(serviceContext?: AiServiceContext): AiProviderConfig | null {
    const ctx = this.getContext(serviceContext);
    return ctx.provider;
  }
}

export const globalAiService = new GlobalAiService();
