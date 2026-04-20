import { getBackendBaseURL } from "@/core/config";
import { useAiProviderStore, type AiProviderConfig } from "./ai-provider-store";

const API_BASE_URL = getBackendBaseURL();

export interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiRequestOptions {
  messages: AiMessage[];
  context?: Record<string, unknown>;
  novelId?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  providerId?: string;
}

export interface AiStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onAbort?: () => void;
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

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number,
  timeoutMs: number,
  retryDelayMs: number
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
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

      if (error instanceof AiServiceError && !error.info.retryable) {
        throw error;
      }

      if (attempt < retries) {
        const backoffDelay = retryDelayMs * Math.pow(2, attempt);
        console.warn(
          `AI请求失败 (尝试 ${attempt + 1}/${retries + 1}): ${lastError.message}. ${backoffDelay}ms后重试...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, backoffDelay)
        );
      }
    }
  }

  throw lastError || new Error("Unknown error after retries");
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
        retryable: true,
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
      ERROR_CATALOG.NO_PROVIDER!
    );
  }

  if (!provider.apiKey || provider.apiKey.trim() === "") {
    throw new AiServiceError(
      "API key is missing",
      {
        code: "NO_API_KEY",
        message: `供应商 "${provider.name}" 的API密钥未配置`,
        provider: provider.name,
        retryable: false,
        severity: "high",
        suggestion: ERROR_CATALOG.NO_API_KEY?.suggestion,
      }
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
      provider: store.getActiveProvider(),
      providers: store.providers,
      enableStreamMode: store.enableStreamMode,
      globalSystemPrompt: store.globalSystemPrompt,
      requestTimeout: store.requestTimeout,
      maxRetries: store.maxRetries,
    };
  }

  async chat(
    options: AiRequestOptions,
    callbacks?: AiStreamCallbacks,
    serviceContext?: AiServiceContext
  ): Promise<string> {
    const ctx = this.getContext(serviceContext);
    const provider =
      ctx.providers.find((p) => p.id === options.providerId) ||
      ctx.provider;

    validateProviderConfig(provider);

    const {
      stream = ctx.enableStreamMode,
      temperature = provider?.temperature ?? 0.7,
      maxTokens = provider?.maxTokens ?? 2000,
      model = provider?.models[0],
    } = options;

    this.abortController = new AbortController();

    const signal =
      mergeAbortSignals([
        this.abortController.signal,
        callbacks?.abortSignal,
      ]) ?? this.abortController.signal;

    try {
      const endpoint = `${API_BASE_URL}/api/ai/chat`;

      let messages = [...options.messages];

      if (ctx.globalSystemPrompt && ctx.globalSystemPrompt.trim()) {
        const hasSystemMessage = messages.some(
          (msg) => msg.role === "system"
        );

        if (hasSystemMessage) {
          messages = messages.map((msg) =>
            msg.role === "system"
              ? {
                  ...msg,
                  content: `${ctx.globalSystemPrompt}\n\n${msg.content}`,
                }
              : msg
          );
        } else {
          messages.unshift({
            role: "system",
            content: ctx.globalSystemPrompt,
          });
        }
      }

      const requestContext = options.novelId
        ? {
            ...(options.context ?? {}),
            novelId: options.novelId,
            novel_id: options.novelId,
          }
        : options.context;

      const requestBody = {
        messages,
        stream,
        context: requestContext,
        provider_config: {
          provider: provider!.provider,
          base_url: provider!.baseUrl,
          model_name: model,
          temperature,
          max_tokens: maxTokens,
        },
      };

      const response = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal,
        },
        ctx.maxRetries,
        ctx.requestTimeout,
        1000
      );

      if (!stream) {
        const data = await response.json();
        const content = data.content || data.message?.content || "";
        callbacks?.onComplete?.(content);
        return content;
      }

      return await this.processStreamResponse(
        response,
        callbacks,
        ctx.requestTimeout
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
    timeoutMs: number = 30000
  ): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body available");
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

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
        const parsed = JSON.parse(data);
        const content =
          parsed.content ||
          parsed.delta?.content ||
          parsed.choices?.[0]?.delta?.content ||
          "";
        if (content) {
          fullText += content;
          callbacks?.onChunk?.(content);
        }
      } catch {
        if (data.trim()) {
          fullText += data;
          callbacks?.onChunk?.(data);
        }
      }
    };

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

    callbacks?.onComplete?.(fullText);
    return fullText;
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
    const ctx = this.getContext(serviceContext);
    const provider = ctx.providers.find((p) => p.id === providerId);

    validateProviderConfig(provider);

    const startTime = Date.now();

    try {
      const response = await fetchWithTimeout(
        `${API_BASE_URL}/api/ai/test-connection`,
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
      return {
        success: false,
        message: errorData.message || `连接失败: ${response.status}`,
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
