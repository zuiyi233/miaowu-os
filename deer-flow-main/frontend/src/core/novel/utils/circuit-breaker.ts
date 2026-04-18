export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  onStateChange?: (state: CircuitState, reason: string) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  openUntil?: number;
}

export class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private openUntil = 0;
  private state: CircuitState = "closed";
  private probeInFlight = false;

  constructor(private config: CircuitBreakerConfig = {}) {}

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime || undefined,
      lastSuccessTime: this.lastSuccessTime || undefined,
      openUntil: this.openUntil || undefined,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === "open") {
      throw new Error(
        `Circuit breaker is OPEN. Service unavailable. Will retry after ${Math.max(0, this.openUntil - Date.now())}ms`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private checkState(): void {
    const now = Date.now();

    if (this.state === "open") {
      if (now >= this.openUntil) {
        this.transitionTo("half-open", "Recovery timeout elapsed, entering half-open state");
        this.probeInFlight = false;
      }
    }
  }

  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();

    if (this.state === "half-open") {
      this.transitionTo("closed", "Probe succeeded, circuit reset to closed");
      this.probeInFlight = false;
    }

    if (this.state === "closed") {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    const threshold = this.config.failureThreshold ?? 5;

    if (this.state === "half-open") {
      this.openUntil = Date.now() + (this.config.recoveryTimeoutMs ?? 60000);
      this.transitionTo("open", "Probe failed, circuit re-opening");
      this.probeInFlight = false;
      return;
    }

    if (this.failureCount >= threshold) {
      this.openUntil = Date.now() + (this.config.recoveryTimeoutMs ?? 60000);

      if (this.state !== "open") {
        this.transitionTo(
          "open",
          `Failure threshold reached (${this.failureCount}/${threshold}). Circuit opening.`
        );
      }
    }
  }

  private transitionTo(newState: CircuitState, reason: string): void {
    const oldState = this.state;
    this.state = newState;

    console.warn(`[CircuitBreaker] ${oldState.toUpperCase()} → ${newState.toUpperCase()}: ${reason}`);

    this.config.onStateChange?.(newState, reason);
  }

  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.state = "closed";
    this.probeInFlight = false;
    this.openUntil = 0;
    this.lastFailureTime = 0;
    this.lastSuccessTime = 0;
  }

  isOpen(): boolean {
    this.checkState();
    return this.state === "open";
  }
}

export const globalCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeoutMs: 60000,
});
