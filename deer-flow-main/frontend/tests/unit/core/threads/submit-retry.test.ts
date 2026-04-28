import { describe, expect, it } from "vitest";

import {
  getThreadSubmitHint,
  isAbortLikeError,
  shouldRetrySubmitError,
} from "@/core/threads/submit-retry";

describe("submit-retry helpers", () => {
  it("does not retry deterministic provider/setup failures", () => {
    const error = {
      status: 500,
      message: "chat_model_unavailable: No active AI provider configured",
    };

    expect(shouldRetrySubmitError(error)).toBe(false);
    expect(getThreadSubmitHint(error)).toContain("AI 配置尚未就绪");
  });

  it("does not retry auth failures and returns auth hint", () => {
    const error = {
      status: 401,
      message: "invalid api key",
    };

    expect(shouldRetrySubmitError(error)).toBe(false);
    expect(getThreadSubmitHint(error)).toContain("认证失败");
  });

  it("recognizes authorization-failed messages as auth errors", () => {
    const error = new Error("Error code: 403 - {'error': {'message': 'Authorization failed'}}");

    expect(shouldRetrySubmitError(error)).toBe(false);
    expect(getThreadSubmitHint(error)).toContain("认证失败");
  });

  it("retries transient gateway errors", () => {
    const error = {
      status: 503,
      message: "service temporarily unavailable",
    };

    expect(shouldRetrySubmitError(error)).toBe(true);
    expect(getThreadSubmitHint(error)).toBeNull();
  });

  it("retries network-code errors without explicit status", () => {
    const error = {
      code: "ECONNRESET",
      message: "socket hang up",
    };

    expect(shouldRetrySubmitError(error)).toBe(true);
  });

  it("treats abort as non-retryable control flow", () => {
    const error = new Error("The user aborted a request");
    error.name = "AbortError";

    expect(isAbortLikeError(error)).toBe(true);
    expect(shouldRetrySubmitError(error)).toBe(false);
  });

  it("treats user-aborted message as abort even without AbortError name", () => {
    const error = new Error("The user aborted a request.");

    expect(isAbortLikeError(error)).toBe(true);
    expect(shouldRetrySubmitError(error)).toBe(false);
  });
});
