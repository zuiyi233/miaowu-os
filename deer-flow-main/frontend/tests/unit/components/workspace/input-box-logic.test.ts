import { expect, test } from "vitest";

import {
  buildFollowupSuggestionsRequestBody,
  resolveModuleId,
  resolveNextModelSelection,
  shouldShowFollowups,
} from "@/components/workspace/input-box-logic";

import type { Model } from "@/core/models/types";

function makeModel(name: string, providerId?: string): Model {
  return {
    id: name,
    name,
    model: name,
    display_name: name,
    provider_id: providerId ?? null,
  };
}

test("should hide followups when pending clarification exists", () => {
  expect(
    shouldShowFollowups({
      disabled: false,
      isNewThread: false,
      hasPendingClarification: true,
      followupsHidden: false,
      followupsLoading: true,
      followupsCount: 3,
    }),
  ).toBe(false);
});

test("should show followups when loading and no pending clarification", () => {
  expect(
    shouldShowFollowups({
      disabled: false,
      isNewThread: false,
      hasPendingClarification: false,
      followupsHidden: false,
      followupsLoading: true,
      followupsCount: 0,
    }),
  ).toBe(true);
});

test("should hide followups when hidden flag is set", () => {
  expect(
    shouldShowFollowups({
      disabled: false,
      isNewThread: false,
      hasPendingClarification: false,
      followupsHidden: true,
      followupsLoading: false,
      followupsCount: 2,
    }),
  ).toBe(false);
});

test("should route followup suggestions through configured feature module", () => {
  const payload = buildFollowupSuggestionsRequestBody(
    [
      { role: "user", content: "继续写这一章" },
      { role: "assistant", content: "这一章已经推进到转折点。" },
    ],
    3,
  );

  expect(payload).toEqual({
    messages: [
      { role: "user", content: "继续写这一章" },
      { role: "assistant", content: "这一章已经推进到转折点。" },
    ],
    n: 3,
    module_id: "chat-suggestions",
  });
  expect("model_name" in payload).toBe(false);
});

test("resolveNextModelSelection returns null and no change when models list is empty", () => {
  const result = resolveNextModelSelection(undefined, [], null);
  expect(result).toEqual({ modelName: null, changed: false });
});

test("resolveNextModelSelection keeps existing valid model without change", () => {
  const models = [makeModel("mimo-v2.5-pro"), makeModel("gpt-4o")];
  const result = resolveNextModelSelection("gpt-4o", models, "mimo-v2.5-pro");
  expect(result).toEqual({ modelName: "gpt-4o", changed: false });
});

test("resolveNextModelSelection prefers defaultModelName over models[0] when current model is invalid", () => {
  const models = [makeModel("gpt-4o"), makeModel("mimo-v2.5-pro")];
  const result = resolveNextModelSelection(
    "nonexistent-model",
    models,
    "mimo-v2.5-pro",
  );
  expect(result).toEqual({ modelName: "mimo-v2.5-pro", changed: true });
});

test("resolveNextModelSelection falls back to models[0] when defaultModelName is null", () => {
  const models = [makeModel("gpt-4o"), makeModel("mimo-v2.5-pro")];
  const result = resolveNextModelSelection("nonexistent-model", models, null);
  expect(result).toEqual({ modelName: "gpt-4o", changed: true });
});

test("resolveNextModelSelection falls back to models[0] when defaultModelName does not match any model", () => {
  const models = [makeModel("gpt-4o"), makeModel("mimo-v2.5-pro")];
  const result = resolveNextModelSelection(
    undefined,
    models,
    "unavailable-default",
  );
  expect(result).toEqual({ modelName: "gpt-4o", changed: true });
});

test("resolveNextModelSelection uses defaultModelName when current model is undefined", () => {
  const models = [makeModel("gpt-4o"), makeModel("mimo-v2.5-pro")];
  const result = resolveNextModelSelection(undefined, models, "mimo-v2.5-pro");
  expect(result).toEqual({ modelName: "mimo-v2.5-pro", changed: true });
});

test("resolveModuleId returns chat-main when no agent name", () => {
  expect(resolveModuleId()).toBe("chat-main");
  expect(resolveModuleId(undefined)).toBe("chat-main");
  expect(resolveModuleId("")).toBe("chat-main");
});

test("resolveModuleId returns agent-chat when agent name is present", () => {
  expect(resolveModuleId("novel-writer")).toBe("agent-chat");
  expect(resolveModuleId("code-reviewer")).toBe("agent-chat");
});
