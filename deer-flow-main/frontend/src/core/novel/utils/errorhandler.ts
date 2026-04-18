export enum ErrorType {
  NETWORK_ERROR = "NETWORK_ERROR",
  API_ERROR = "API_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  ABORT_ERROR = "ABORT_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * 403 Forbidden 错误子类型枚举
 * 用于细分 HTTP 403 错误的不同场景，指导上层重试策略和用户提示
 */
export enum ForbiddenSubType {
  /** 认证失败（如 API Key 无效、Token 过期）— 不可重试，需用户更新凭证 */
  AUTH_FAILED = "AUTH_FAILED",
  /** 请求限流（如 QPS 超限、配额耗尽）— 可重试，建议结合 retryAfterMs 延迟 */
  RATE_LIMITED = "RATE_LIMITED",
  /** 地域限制（如服务仅对特定国家开放）— 不可重试，需更换网络环境或代理 */
  GEO_BLOCKED = "GEO_BLOCKED",
  /** WAF 安全挑战（如 Cloudflare 人机验证）— 可重试，通过后即可恢复正常 */
  WAF_CHALLENGE = "WAF_CHALLENGE",
  /** IP 封禁（如多次违规、恶意行为）— 不可重试，需联系服务方解封 */
  IP_BANNED = "IP_BANNED",
  /** 无法归类的其他 403 错误 — 默认兜底类型，保守视为可重试 */
  UNKNOWN = "UNKNOWN",
}

export interface StandardError {
  type: ErrorType;
  message: string;
  code?: string | number;
  details?: Record<string, any>;
  timestamp: Date;
  originalError?: Error;
}

export interface ExtendedStandardError extends StandardError {
  forbiddenSubType?: ForbiddenSubType;
  retryAfterMs?: number;
}

export class ErrorHandler {
  private options: { enableLogging: boolean; customMessages: Partial<Record<ErrorType, string>>; onError: (error: StandardError) => void; showUserNotification: boolean };

  constructor(options: { enableLogging?: boolean; customMessages?: Partial<Record<ErrorType, string>>; onError?: (error: StandardError) => void; showUserNotification?: boolean } = {}) {
    this.options = {
      enableLogging: options.enableLogging ?? true,
      customMessages: options.customMessages ?? {},
      onError: options.onError ?? (() => {}),
      showUserNotification: options.showUserNotification ?? true,
    };
  }

  public handle(error: Error | unknown, context?: string): StandardError {
    const standardError = this.standardizeError(error, context);
    if (this.options.enableLogging) this.logError(standardError);
    this.options.onError(standardError);
    if (this.options.showUserNotification) this.showUserNotification(standardError);
    return standardError;
  }

  private standardizeError(error: Error | unknown, context?: string): StandardError {
    if (error instanceof Error) {
      if (error.name === "TypeError" && error.message.includes("fetch")) {
        return { type: ErrorType.NETWORK_ERROR, message: this.options.customMessages[ErrorType.NETWORK_ERROR] || "网络连接失败", code: "NETWORK_FAILED", timestamp: new Date(), originalError: error, details: { context } };
      }
      if (error.name === "AbortError" || error.message === "请求已取消") {
        return { type: ErrorType.ABORT_ERROR, message: this.options.customMessages[ErrorType.ABORT_ERROR] || "请求已取消", code: "REQUEST_ABORTED", timestamp: new Date(), originalError: error, details: { context } };
      }
      if (error.name === "TimeoutError") {
        return { type: ErrorType.TIMEOUT_ERROR, message: this.options.customMessages[ErrorType.TIMEOUT_ERROR] || "请求超时", code: "REQUEST_TIMEOUT", timestamp: new Date(), originalError: error, details: { context } };
      }
      if ("status" in error) {
        const apiError = error as any;
        const baseError: StandardError = { type: ErrorType.API_ERROR, message: this.options.customMessages[ErrorType.API_ERROR] || `API 请求失败 (${apiError.status})`, code: apiError.status, timestamp: new Date(), originalError: error, details: { context, status: apiError.status, statusText: apiError.statusText } };

        if (apiError.status === 403) {
          const responseBody = apiError.responseBody || apiError.body || {};
          const headers = apiError.headers || {};
          return {
            ...baseError,
            forbiddenSubType: this.classify403Error(responseBody, headers),
            retryAfterMs: this.parseRetryAfterHeader(headers),
            details: { ...baseError.details, responseBody, headers },
          } as ExtendedStandardError;
        }

        return baseError;
      }
    }
    return { type: ErrorType.UNKNOWN_ERROR, message: this.options.customMessages[ErrorType.UNKNOWN_ERROR] || "发生未知错误", code: "UNKNOWN", timestamp: new Date(), originalError: error instanceof Error ? error : new Error(String(error)), details: { context } };
  }

  private classify403Error(body: Record<string, any>, headers: Record<string, string>): ForbiddenSubType {
    const errorObj = body.error || {};
    const message = ((errorObj.message || body.message || "") as string).toLowerCase();

    if (message.includes("rate limit") || message.includes("too many requests") || message.includes("quota")) {
      return ForbiddenSubType.RATE_LIMITED;
    }
    if (message.includes("geo") || message.includes("region") || message.includes("country") || message.includes("location")) {
      return ForbiddenSubType.GEO_BLOCKED;
    }
    if (message.includes("cloudflare") || message.includes("challenge") || message.includes("cf-") || headers["cf-ray"] || headers["cf-challenge"]) {
      return ForbiddenSubType.WAF_CHALLENGE;
    }
    if (message.includes("invalid api key") || message.includes("unauthorized") || message.includes("authentication") || message.includes("forbidden") && message.includes("access")) {
      return ForbiddenSubType.AUTH_FAILED;
    }
    if (message.includes("ip") && (message.includes("banned") || message.includes("blocked") || message.includes("blacklisted"))) {
      return ForbiddenSubType.IP_BANNED;
    }

    return ForbiddenSubType.UNKNOWN;
  }

  private parseRetryAfterHeader(headers: Record<string, string>): number | undefined {
    const retryAfter = headers["retry-after"] || headers["Retry-After"];
    if (!retryAfter) return undefined;

    try {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    } catch {
    }

    return undefined;
  }

  private logError(error: StandardError): void {
    switch (error.type) {
      case ErrorType.NETWORK_ERROR: case ErrorType.TIMEOUT_ERROR: console.warn("Warning:", error.message); break;
      case ErrorType.ABORT_ERROR: console.info("Info:", error.message); break;
      default: console.error("Error:", error.message);
    }
  }

  private showUserNotification(error: StandardError): void {
    import("sonner").then(({ toast }) => {
      switch (error.type) {
        case ErrorType.NETWORK_ERROR: toast.error(error.message, { description: "请检查网络连接后重试" }); break;
        case ErrorType.TIMEOUT_ERROR: toast.warning(error.message, { description: "请求耗时过长" }); break;
        case ErrorType.ABORT_ERROR: break;
        case ErrorType.API_ERROR: error.code === 429 ? toast.warning("请求过于频繁") : toast.error(error.message); break;
        default: toast.error(error.message);
      }
    }).catch(() => {});
  }

  public isRetryableError(error: StandardError): boolean {
    const retryableTypes = [ErrorType.NETWORK_ERROR, ErrorType.TIMEOUT_ERROR, ErrorType.API_ERROR];
    if (error.type === ErrorType.API_ERROR) {
      const extError = error as ExtendedStandardError;
      if (Number(extError.code) === 403) {
        switch (extError.forbiddenSubType) {
          case ForbiddenSubType.AUTH_FAILED:
            return false;
          case ForbiddenSubType.RATE_LIMITED:
          case ForbiddenSubType.WAF_CHALLENGE:
            return true;
          case ForbiddenSubType.GEO_BLOCKED:
          case ForbiddenSubType.IP_BANNED:
            return false;
          case ForbiddenSubType.UNKNOWN:
          default:
            return true;
        }
      }
      return ![400, 401, 404, 422].includes(Number(error.code));
    }
    return retryableTypes.includes(error.type);
  }
}

export const globalErrorHandler = new ErrorHandler({
  enableLogging: true,
  showUserNotification: true,
  customMessages: {
    [ErrorType.NETWORK_ERROR]: "网络连接异常",
    [ErrorType.TIMEOUT_ERROR]: "请求超时",
    [ErrorType.API_ERROR]: "服务请求失败",
    [ErrorType.ABORT_ERROR]: "操作已取消",
    [ErrorType.UNKNOWN_ERROR]: "系统异常",
  },
});

export const handleError = (error: Error | unknown, context?: string): StandardError => globalErrorHandler.handle(error, context);
