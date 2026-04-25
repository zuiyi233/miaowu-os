import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ProviderCard } from "@/components/workspace/settings/ai-provider-settings-page";

function createProviderCardMarkup(
  overrides?: Partial<{
    id: string;
    name: string;
    provider: "openai" | "anthropic" | "google" | "custom";
    apiKey: string;
    baseUrl: string;
    models: string[];
    isActive: boolean;
    hasApiKey: boolean;
    clearApiKey: boolean;
  }>
) {
  return renderToStaticMarkup(
    React.createElement(ProviderCard, {
      provider: {
        id: "provider-1",
        name: "OpenAI",
        provider: "openai",
        apiKey: "",
        baseUrl: "",
        models: ["gpt-4o-mini"],
        isActive: true,
        hasApiKey: false,
        clearApiKey: false,
        ...overrides,
      },
      isEditing: true,
      formData: {
        name: "OpenAI",
        provider: "openai",
        apiKey: "",
        baseUrl: "",
        models: ["gpt-4o-mini"],
      },
      onEdit: () => undefined,
      onCancel: () => undefined,
      onSave: () => undefined,
      onDelete: () => undefined,
      onSetActive: () => undefined,
      onFormChange: () => undefined,
      fetchingModels: false,
      fetchModelsError: null,
      onFetchModels: () => undefined,
    })
  );
}

test("provider card renders API key input as password type by default", () => {
  const html = createProviderCardMarkup();
  expect(html).toContain("type=\"password\"");
});

test("provider card shows clear key button when hasApiKey is true", () => {
  const html = createProviderCardMarkup({ hasApiKey: true });
  expect(html).toContain("清空已保存的 Key");
});

test("provider card displays active badge when isActive is true", () => {
  const html = createProviderCardMarkup({ isActive: true });
  expect(html).toContain("当前使用");
});

test("provider card does not display active badge when isActive is false", () => {
  const html = createProviderCardMarkup({ isActive: false });
  expect(html).not.toContain("当前使用");
});

test("provider card shows set-as-default button when not active", () => {
  const html = createProviderCardMarkup({ isActive: false });
  expect(html).toContain("设为默认");
});
