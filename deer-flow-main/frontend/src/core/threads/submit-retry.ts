const RETRYABLE_ERROR_CODES = new Set([
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

const RETRYABLE_MESSAGE_PATTERNS = [
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

const SETTINGS_OR_MODEL_PATTERNS = [
  "ai settings",
  "hydrate ai settings",
  "chat_model_unavailable",
  "model not found",
  "no models configured",
  "no active ai provider",
  "provider not configured",
  "provider not found",
  "未配置可用模型",
  "未配置",
  "服务商",
];

const AUTH_PATTERNS = [
  "invalid api key",
  "incorrect api key",
  "authentication",
  "authorization",
  "authorization failed",
  "auth failed",
  "unauthorized",
  "forbidden",
  "api key",
  "认证失败",
];

export function getThreadStreamErrorMessage(error: unknown): string {
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

export function isAbortLikeError(error: unknown): boolean {
  const safeGet = (value: unknown, key: string): unknown => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return undefined;
    }
    return Reflect.get(value, key);
  };

  const lowerMessage = getThreadStreamErrorMessage(error).toLowerCase();
  if (
    lowerMessage.includes("user aborted a request") ||
    lowerMessage.includes("the user aborted a request") ||
    lowerMessage.includes("request was aborted")
  ) {
    return true;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  if (typeof error === "object" && error !== null) {
    const name = Reflect.get(error, "name");
    if (typeof name === "string" && name === "AbortError") {
      return true;
    }

    const codeCandidates = [
      safeGet(error, "code"),
      safeGet(safeGet(error, "cause"), "code"),
      safeGet(safeGet(error, "error"), "code"),
    ];
    for (const code of codeCandidates) {
      if (typeof code === "string" && (code === "ERR_CANCELED" || code === "ABORT_ERR")) {
        return true;
      }
    }
  }
  return false;
}

function parseErrorStatusCode(error: unknown): number | null {
  const safeGet = (value: unknown, key: string): unknown => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return undefined;
    }
    return Reflect.get(value, key);
  };

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
    safeGet(error, "status"),
    safeGet(error, "statusCode"),
    safeGet(safeGet(error, "response"), "status"),
    safeGet(safeGet(error, "cause"), "status"),
  ];
  for (const candidate of statusCandidates) {
    const parsed = parseStatus(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  const nested = safeGet(error, "error");
  if (nested && typeof nested === "object") {
    const nestedCandidates = [
      safeGet(nested, "status"),
      safeGet(nested, "statusCode"),
      safeGet(safeGet(nested, "response"), "status"),
      safeGet(safeGet(nested, "cause"), "status"),
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

function hasRetryableErrorCode(error: unknown): boolean {
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
  return codeCandidates.some(
    (candidate) =>
      typeof candidate === "string" && RETRYABLE_ERROR_CODES.has(candidate),
  );
}

function messageMatchesAnyPattern(
  message: string,
  patterns: ReadonlyArray<string>,
): boolean {
  return patterns.some((pattern) => message.includes(pattern));
}

export function getThreadSubmitHint(error: unknown): string | null {
  const message = getThreadStreamErrorMessage(error).toLowerCase();
  const statusCode = parseErrorStatusCode(error);

  if (messageMatchesAnyPattern(message, SETTINGS_OR_MODEL_PATTERNS)) {
    return "聊天请求未执行：AI 配置尚未就绪。请在「设置 > AI 服务商」中保存并设为默认服务商，并确认模型列表非空后重试。";
  }

  if (
    statusCode === 401 ||
    statusCode === 402 ||
    statusCode === 403 ||
    messageMatchesAnyPattern(message, AUTH_PATTERNS)
  ) {
    return "供应商认证失败：请检查 base_url / API Key 是否正确，并在「设置 > AI 服务商」保存后重试。";
  }

  return null;
}

export function shouldRetrySubmitError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return false;
  }

  const message = getThreadStreamErrorMessage(error).toLowerCase();
  if (
    messageMatchesAnyPattern(message, SETTINGS_OR_MODEL_PATTERNS) ||
    messageMatchesAnyPattern(message, AUTH_PATTERNS)
  ) {
    return false;
  }

  const statusCode = parseErrorStatusCode(error);
  if (statusCode !== null) {
    if (statusCode === 408 || statusCode === 409 || statusCode === 425) {
      return true;
    }
    if (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return true;
    }

    if (statusCode === 500) {
      return (
        hasRetryableErrorCode(error) ||
        messageMatchesAnyPattern(message, RETRYABLE_MESSAGE_PATTERNS)
      );
    }

    if (statusCode >= 500) {
      return (
        hasRetryableErrorCode(error) ||
        messageMatchesAnyPattern(message, RETRYABLE_MESSAGE_PATTERNS)
      );
    }

    return false;
  }

  if (hasRetryableErrorCode(error)) {
    return true;
  }

  return messageMatchesAnyPattern(message, RETRYABLE_MESSAGE_PATTERNS);
}
