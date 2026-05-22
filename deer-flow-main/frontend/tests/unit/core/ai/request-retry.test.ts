import { expect, test } from "vitest";

import { runWithRetry } from "@/core/ai/request-retry";

test("runWithRetry retries retryable failures until a later success", async () => {
  let attempts = 0;

  const result = await runWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("temporary failure");
      }
      return "ok";
    },
    {
      retries: 2,
      retryDelayMs: 0,
      shouldRetryError: () => true,
    }
  );

  expect(result).toBe("ok");
  expect(attempts).toBe(2);
});
