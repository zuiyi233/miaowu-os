import { expect, test } from "vitest";

import {
  createDefaultProvider,
  parseModelsInput,
} from "@/components/novel/settings/ProviderSettings";

test("createDefaultProvider returns default openai provider without api key", () => {
  const provider = createDefaultProvider("provider-1");

  expect(provider).toEqual({
    id: "provider-1",
    name: "New Provider",
    provider: "openai",
    apiKey: "",
    baseUrl: "",
    models: [],
    isActive: false,
    hasApiKey: false,
    clearApiKey: false,
  });
});

test("parseModelsInput trims spaces and removes empty entries", () => {
  expect(parseModelsInput("gpt-4o,  gpt-4o-mini ,, ,o3")).toEqual([
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
  ]);
});
