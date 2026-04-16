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

export interface StandardError {
  type: ErrorType;
  message: string;
  code?: string | number;
  details?: Record<string, any>;
  timestamp: Date;
  originalError?: Error;
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
        return { type: ErrorType.API_ERROR, message: this.options.customMessages[ErrorType.API_ERROR] || `API 请求失败 (${apiError.status})`, code: apiError.status, timestamp: new Date(), originalError: error, details: { context, status: apiError.status, statusText: apiError.statusText } };
      }
    }
    return { type: ErrorType.UNKNOWN_ERROR, message: this.options.customMessages[ErrorType.UNKNOWN_ERROR] || "发生未知错误", code: "UNKNOWN", timestamp: new Date(), originalError: error instanceof Error ? error : new Error(String(error)), details: { context } };
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
      return ![400, 401, 403, 404, 422].includes(Number(error.code));
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
