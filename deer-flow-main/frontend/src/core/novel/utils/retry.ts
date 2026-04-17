import { handleError, type StandardError, ErrorType } from "./errorhandler";

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
        const delay = this.calculateDelay(attempt, opts);
        opts.onRetry(attempt, lastError, delay);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return { success: false, error: lastError, attempts: opts.maxAttempts, duration: Date.now() - start };
  }

  private defaultShouldRetry(error: StandardError, attempt: number): boolean {
    if (error.type === ErrorType.API_ERROR) {
      if ([400, 401, 403, 404, 422].includes(Number(error.code))) return false;
      if (error.code === 429) return attempt <= 2;
    }
    return [ErrorType.NETWORK_ERROR, ErrorType.TIMEOUT_ERROR, ErrorType.API_ERROR].includes(error.type);
  }

  private calculateDelay(attempt: number, opts: Required<RetryOptions>): number {
    let delay = opts.baseDelay * Math.pow(opts.backoffFactor, attempt - 1);
    delay = Math.min(delay, opts.maxDelay);
    if (opts.jitterFactor > 0) delay += delay * opts.jitterFactor * Math.random();
    return Math.floor(delay);
  }
}

export const globalRetryManager = new RetryManager();
export const retry = async <T>(fn: () => Promise<T>, options?: RetryOptions, context?: string): Promise<RetryResult<T>> => globalRetryManager.execute(fn, options, context);
