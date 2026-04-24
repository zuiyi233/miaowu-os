import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitBreaker } from '@/core/novel/utils/circuit-breaker';
import { ErrorHandler, ErrorType, ForbiddenSubType } from '@/core/novel/utils/errorhandler';
import type { ExtendedStandardError } from '@/core/novel/utils/errorhandler';
import { RetryManager } from '@/core/novel/utils/retry';

describe('403 Retry Mechanism', () => {
  let errorHandler: ErrorHandler;
  let retryManager: RetryManager;

  beforeEach(() => {
    errorHandler = new ErrorHandler({
      enableLogging: false,
      showUserNotification: false,
    });
    retryManager = new RetryManager();
  });

  it('should retry on WAF challenge 403', async () => {
    const error403 = Object.assign(new Error('Forbidden'), {
      status: 403,
      statusText: 'Forbidden',
      responseBody: { error: { message: 'cloudflare challenge' } },
      headers: { 'cf-ray': 'abc123' },
    });

    const standardized = errorHandler.handle(error403) as ExtendedStandardError;
    expect(standardized.forbiddenSubType).toBe(ForbiddenSubType.WAF_CHALLENGE);

    const shouldRetry = retryManager.defaultShouldRetry(standardized, 1);
    expect(shouldRetry).toBe(true);
  });

  it('should NOT retry on auth failed 403', async () => {
    const error403 = Object.assign(new Error('Forbidden'), {
      status: 403,
      statusText: 'Forbidden',
      responseBody: { error: { message: 'invalid api key' } },
    });

    const standardized = errorHandler.handle(error403) as ExtendedStandardError;
    expect(standardized.forbiddenSubType).toBe(ForbiddenSubType.AUTH_FAILED);

    const shouldRetry = retryManager.defaultShouldRetry(standardized, 1);
    expect(shouldRetry).toBe(false);
  });

  it('should respect Retry-After header in delay calculation', async () => {
    const error403 = Object.assign(new Error('Forbidden'), {
      status: 403,
      statusText: 'Forbidden',
      responseBody: {},
      headers: { 'retry-after': '5' },
    });

    const standardized = errorHandler.handle(error403) as ExtendedStandardError;
    expect(standardized.retryAfterMs).toBe(5000);

    const delay = retryManager.calculateDelay(
      1,
      {
        maxAttempts: 3,
        baseDelay: 1000,
        backoffFactor: 2,
        maxDelay: 10000,
        jitterFactor: 0,
        shouldRetry: (error, attempt) => retryManager.defaultShouldRetry(error, attempt),
        onRetry: () => void 0,
      },
      standardized
    );
    expect(delay).toBe(5000);
  });
});

describe('Circuit Breaker Mechanism', () => {
  it('should trigger circuit breaker after 5 consecutive failures', async () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      recoveryTimeoutMs: 60000,
    });

    for (let i = 0; i < 5; i++) {
      try {
        await circuitBreaker.execute(async () => {
          throw new Error(`Failure ${i + 1}`);
        });
      } catch (error) {
        expect((error as Error).message).toContain(`Failure ${i + 1}`);
      }
    }

    expect(circuitBreaker.isOpen()).toBe(true);

    await expect(
      circuitBreaker.execute(async () => {
        throw new Error('Should not reach here');
      })
    ).rejects.toThrow('Circuit breaker is OPEN');
  });

  it('should recover after recovery timeout', async () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
    });

    try {
      await circuitBreaker.execute(async () => {
        throw new Error('Failure 1');
      });
    } catch (error) {
      void error;
    }

    try {
      await circuitBreaker.execute(async () => {
        throw new Error('Failure 2');
      });
    } catch (error) {
      void error;
    }

    expect(circuitBreaker.isOpen()).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(circuitBreaker.isOpen()).toBe(false);

    const result = await circuitBreaker.execute(async () => 'Success after recovery');
    expect(result).toBe('Success after recovery');

    const stats = circuitBreaker.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.failureCount).toBe(0);
  });
});
