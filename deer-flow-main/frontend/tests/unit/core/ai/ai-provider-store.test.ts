import { expect, test } from "vitest";

import { buildMigrationPayloadFromLegacySource } from "@/core/ai/ai-provider-store";

test("buildMigrationPayloadFromLegacySource maps provider payload with explicit providers list", () => {
  const payload = buildMigrationPayloadFromLegacySource({
    providers: [
      {
        id: "provider-1",
        name: "OpenAI",
        provider: "openai",
        base_url: "https://api.openai.com/v1",
        models: ["gpt-4o-mini"],
        is_active: true,
        max_tokens: 4096,
        temperature: 0.2,
        api_key: "sk-test-key",
      },
    ],
    defaultProviderId: "provider-1",
    enableStreamMode: false,
    requestTimeout: 12000,
    maxRetries: 3,
    globalSystemPrompt: "system prompt",
  });

  expect(payload).not.toBeNull();
  expect(payload?.default_provider_id).toBe("provider-1");
  expect(payload?.providers).toHaveLength(1);
  expect(payload?.providers?.[0]).toMatchObject({
    id: "provider-1",
    name: "OpenAI",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-4o-mini"],
    is_active: true,
    max_tokens: 4096,
    temperature: 0.2,
    api_key: "sk-test-key",
  });
  expect(payload?.client_settings).toEqual({
    enable_stream_mode: false,
    request_timeout: 12000,
    max_retries: 3,
  });
  expect(payload?.system_prompt).toBe("system prompt");
});

test("buildMigrationPayloadFromLegacySource supports legacy llmProviders and defaults", () => {
  const payload = buildMigrationPayloadFromLegacySource({
    llmProviders: [
      {
        id: "legacy-1",
        name: "Legacy",
        provider: "custom",
        baseUrl: "http://localhost:1234/v1",
        models: ["my-model"],
      },
    ],
  });

  expect(payload).not.toBeNull();
  expect(payload?.providers).toHaveLength(1);
  expect(payload?.providers?.[0]).toMatchObject({
    id: "legacy-1",
    name: "Legacy",
    provider: "custom",
    base_url: "http://localhost:1234/v1",
    models: ["my-model"],
    is_active: false,
    temperature: null,
    max_tokens: null,
  });
  expect(payload?.client_settings).toEqual({
    enable_stream_mode: true,
    request_timeout: 660000,
    max_retries: 2,
  });
  expect(payload?.system_prompt).toBe("");
});

test("buildMigrationPayloadFromLegacySource returns null when providers are missing", () => {
  expect(
    buildMigrationPayloadFromLegacySource({
      defaultProviderId: "any",
    })
  ).toBeNull();
});
