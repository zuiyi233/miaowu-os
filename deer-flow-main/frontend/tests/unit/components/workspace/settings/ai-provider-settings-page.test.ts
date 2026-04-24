import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import {
  ApiKeyVisibilityToggle,
  ProviderCard,
} from "@/components/workspace/settings/ai-provider-settings-page";

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
      isTesting: false,
      testResult: null,
      formData: {
        name: "OpenAI",
        provider: "openai",
        apiKey: "",
        baseUrl: "",
        models: ["gpt-4o-mini"],
      },
      onEdit: () => undefined,
      onSave: () => undefined,
      onDelete: () => undefined,
      onSetActive: () => undefined,
      onTestConnection: () => undefined,
      onFormChange: () => undefined,
    })
  );
}

test("API key visibility toggle uses semantic button with aria attributes when hidden", () => {
  const html = renderToStaticMarkup(
    React.createElement(ApiKeyVisibilityToggle, {
      isVisible: false,
      controlId: "provider-api-key-provider-1",
      onToggle: () => undefined,
    })
  );

  expect(html).toContain("type=\"button\"");
  expect(html).toContain("aria-label=\"显示 API Key\"");
  expect(html).toContain("aria-controls=\"provider-api-key-provider-1\"");
  expect(html).toContain("aria-pressed=\"false\"");
});

test("API key visibility toggle updates aria attributes when visible", () => {
  const html = renderToStaticMarkup(
    React.createElement(ApiKeyVisibilityToggle, {
      isVisible: true,
      controlId: "provider-api-key-provider-1",
      onToggle: () => undefined,
    })
  );

  expect(html).toContain("type=\"button\"");
  expect(html).toContain("aria-label=\"隐藏 API Key\"");
  expect(html).toContain("aria-controls=\"provider-api-key-provider-1\"");
  expect(html).toContain("aria-pressed=\"true\"");
});

test("provider card keeps API key input controllable by aria-controls and password by default", () => {
  const html = createProviderCardMarkup();

  expect(html).toContain("id=\"provider-api-key-provider-1\"");
  expect(html).toContain("type=\"password\"");
  expect(html).toContain("aria-controls=\"provider-api-key-provider-1\"");
});
