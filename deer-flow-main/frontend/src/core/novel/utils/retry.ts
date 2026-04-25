import { handleError, type StandardError, ErrorType, ForbiddenSubType, type ExtendedStandardError } from "./errorhandler";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  backoffFactor?: number;
  maxDelay?: number;
  jitterFactor?: number;
  shouldRetry?: (error: StandardError, attempt: number) => boolean;
  onRetry?: (attempt: number, error: StandardError, delay: number) => void;
}

export interface RetryResult<T> { success: boolean; data?: T; error?: StandardError; attempts: number; duration: number; }

export class RetryManager {
  private defaults: Required<RetryOptions>;
  constructor(opts: RetryOptions = {}) {
    this.defaults = {
      maxAttempts: opts.maxAttempts ?? 3, baseDelay: opts.baseDelay ?? 1000,
      backoffFactor: opts.backoffFactor ?? 2, maxDelay: opts.maxDelay ?? 10000,
      jitterFactor: opts.jitterFactor ?? 0.1, shouldRetry: opts.shouldRetry ?? this.defaultShouldRetry,
      onRetry: opts.onRetry ?? (() => {}),
    };
  }

  public async execute<T>(fn: () => Promise<T>, options: RetryOptions = {}, context?: string): Promise<RetryResult<T>> {
    const start = Date.now();
    const opts = { ...this.defaults, ...options };
    let lastError: StandardError | undefined;
    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        const result = await fn();
        return { success: true, data: result, attempts: attempt, duration: Date.now() - start };
      } catch (error) {
        lastError = handleError(error, context);
        if (attempt === opts.maxAttempts || !opts.shouldRetry(lastError, attempt)) break;
        const delay = this.calculateDelay(attempt, opts, lastError);
        opts.onRetry(attempt, lastError, delay);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return { success: false, error: lastError, attempts: opts.maxAttempts, duration: Date.now() - start };
  }

  public defaultShouldRetry(error: StandardError, attempt: number): boolean {
    const extError = error as ExtendedStandardError;

    if (extError.type === ErrorType.API_ERROR) {
      const statusCode = Number(extError.code);

      if ([400, 401, 404, 422].includes(statusCode)) return false;

      if (statusCode === 403) {
        switch (extError.forbiddenSubType) {
          case ForbiddenSubType.AUTH_FAILED:
            return false;
          case ForbiddenSubType.RATE_LIMITED:
          case ForbiddenSubType.WAF_CHALLENGE:
            return attempt <= 2;
          case ForbiddenSubType.GEO_BLOCKED:
          case ForbiddenSubType.IP_BANNED:
            return false;
          case ForbiddenSubType.UNKNOWN:
          default:
            return attempt <= 1;
        }
      }

      if (statusCode === 429) return attempt <= 2;
    }

    return [ErrorType.NETWORK_ERROR, ErrorType.TIMEOUT_ERROR].includes(extError.type);
  }

  public calculateDelay(attempt: number, opts: Required<RetryOptions>, error?: ExtendedStandardError): number {
    if (error?.retryAfterMs && error.retryAfterMs > 0) {
      return Math.min(error.retryAfterMs, opts.maxDelay);
    }

    let delay = opts.baseDelay * Math.pow(opts.backoffFactor, attempt - 1);
    delay = Math.min(delay, opts.maxDelay);

    if (opts.jitterFactor > 0) {
      delay += delay * opts.jitterFactor * Math.random();
    }

    return Math.floor(delay);
  }
}

export const globalRetryManager = new RetryManager();
export const retry = async <T>(fn: () => Promise<T>, options?: RetryOptions, context?: string): Promise<RetryResult<T>> => globalRetryManager.execute(fn, options, context);
