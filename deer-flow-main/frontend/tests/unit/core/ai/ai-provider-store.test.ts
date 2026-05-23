import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

test("ai provider store does not expose browser-local API key migration", async () => {
  const module = await import("@/core/ai/ai-provider-store");

  expect("buildMigrationPayloadFromLegacySource" in module).toBe(false);
});
