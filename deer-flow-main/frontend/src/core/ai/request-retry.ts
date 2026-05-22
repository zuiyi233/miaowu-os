// Keep AI retry behavior centralized so every request uses the same bounded
// backoff policy and malformed retry counts cannot spin the UI forever.

export interface RetryAttemptDetails {
  attempt: number;
  totalAttempts: number;
  delayMs: number;
  error: Error;
}

export interface RetryExecutionOptions {
  retries: number;
  retryDelayMs: number;
  shouldRetryError: (error: unknown) => boolean;
  onRetry?: (details: RetryAttemptDetails) => void;
}

const MAX_RETRY_ATTEMPTS = 20;

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function getRetryDelayMs(retryDelayMs: number, attemptIndex: number): number {
  if (!Number.isFinite(retryDelayMs)) {
    return 0;
  }

  const normalizedBaseDelay = Math.max(0, Math.floor(retryDelayMs));
  return normalizedBaseDelay * (attemptIndex + 1);
}

export function normalizeMaxRetries(maxRetries: number): number {
  if (!Number.isFinite(maxRetries)) {
    return 0;
  }

  const normalized = Math.floor(maxRetries);
  if (normalized < 0) {
    return 0;
  }

  return Math.min(normalized, MAX_RETRY_ATTEMPTS);
}

export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryExecutionOptions
): Promise<T> {
  const effectiveRetries = normalizeMaxRetries(options.retries);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isAbortError(error) || !options.shouldRetryError(error)) {
        throw lastError;
      }

      if (attempt < effectiveRetries) {
        const delayMs = getRetryDelayMs(options.retryDelayMs, attempt);
        options.onRetry?.({
          attempt,
          totalAttempts: effectiveRetries + 1,
          delayMs,
          error: lastError,
        });

        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
    }
  }

  throw lastError ?? new Error("Unknown error after retries");
}
