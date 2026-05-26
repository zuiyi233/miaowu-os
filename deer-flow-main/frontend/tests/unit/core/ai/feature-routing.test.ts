import { expect, test } from "vitest";

import type { AiProviderConfig } from "@/core/ai/ai-provider-store";
import {
  applyGlobalTargetToAllModules,
  getDefaultProviderTarget,
  normalizeFeatureRoutingState,
} from "@/core/ai/feature-routing";

function provider(id: string, models: string[], isActive = false): AiProviderConfig {
  return {
    id,
    name: id,
    provider: "openai",
    baseUrl: "",
    apiKey: "",
    models,
    isActive,
  };
}

test("normalizeFeatureRoutingState repairs stale provider id when model identifies one provider", () => {
  const providers = [
    provider("newapi-managed", ["default-model"]),
    provider("newapi-managed-group-charity", ["charity-model"]),
  ];

  const state = normalizeFeatureRoutingState(
    {
      version: 1,
      defaultTarget: { providerId: "newapi-managed", model: "charity-model" },
      modules: [
        {
          moduleId: "novel-outline",
          moduleLabel: "大纲规划",
          moduleDescription: "小说大纲规划与维护",
          category: "novel",
          runtimeReady: true,
          defaultTarget: { providerId: "newapi-managed", model: "charity-model" },
          primaryTarget: { providerId: "newapi-managed", model: "charity-model" },
          backupTarget: null,
          currentMode: "primary",
          autoFailover: true,
          parallelEnabled: false,
          parallelStrategy: "compare",
          parallelTargets: [{ providerId: "newapi-managed", model: "charity-model" }],
        },
      ],
      channels: [],
      switchLogs: [],
    },
    providers,
  );

  expect(state.defaultTarget).toEqual({
    providerId: "newapi-managed-group-charity",
    model: "charity-model",
  });
  const outline = state.modules.find((module) => module.moduleId === "novel-outline");
  expect(outline?.primaryTarget).toEqual({
    providerId: "newapi-managed-group-charity",
    model: "charity-model",
  });
  expect(outline?.parallelTargets).toEqual([
    {
      providerId: "newapi-managed-group-charity",
      model: "charity-model",
    },
  ]);
});

test("normalizeFeatureRoutingState falls back when stale target model is ambiguous", () => {
  const providers = [
    provider("newapi-managed", ["default-model"]),
    provider("newapi-managed-group-a", ["shared-model"]),
    provider("newapi-managed-group-b", ["shared-model"]),
  ];

  const state = normalizeFeatureRoutingState(
    {
      version: 1,
      defaultTarget: { providerId: "newapi-managed", model: "shared-model" },
      modules: [],
      channels: [],
      switchLogs: [],
    },
    providers,
  );

  expect(state.defaultTarget).toEqual({
    providerId: "newapi-managed",
    model: "default-model",
  });
});

test("getDefaultProviderTarget follows the saved default provider before the first provider", () => {
  const providers = [
    provider("newapi-managed", ["default-model"]),
    provider("newapi-managed-group-cn", ["mimo-v2.5-pro"]),
  ];

  expect(getDefaultProviderTarget(providers, "newapi-managed-group-cn")).toEqual({
    providerId: "newapi-managed-group-cn",
    model: "mimo-v2.5-pro",
  });
});

test("getDefaultProviderTarget falls back to the active provider", () => {
  const providers = [
    provider("newapi-managed", ["default-model"]),
    provider("newapi-managed-group-cn", ["mimo-v2.5-pro"], true),
  ];

  expect(getDefaultProviderTarget(providers, null)).toEqual({
    providerId: "newapi-managed-group-cn",
    model: "mimo-v2.5-pro",
  });
});

test("applyGlobalTargetToAllModules also overrides chat and agent modules", () => {
  const providers = [
    provider("old-provider", ["old-model"]),
    provider("newapi-managed-group-cn", ["mimo-v2.5-pro"]),
  ];
  const state = normalizeFeatureRoutingState(
    {
      version: 1,
      defaultTarget: { providerId: "old-provider", model: "old-model" },
      modules: [
        {
          moduleId: "chat-main",
          moduleLabel: "主项目对话",
          moduleDescription: "工作区默认对话入口 /workspace/chats",
          category: "workspace",
          runtimeReady: true,
          defaultTarget: { providerId: "old-provider", model: "old-model" },
          primaryTarget: { providerId: "old-provider", model: "old-model" },
          backupTarget: null,
          currentMode: "primary",
          autoFailover: true,
          parallelEnabled: false,
          parallelStrategy: "compare",
          parallelTargets: [{ providerId: "old-provider", model: "old-model" }],
        },
        {
          moduleId: "agent-chat",
          moduleLabel: "智能体对话",
          moduleDescription: "自定义智能体聊天 /workspace/agents/*/chats",
          category: "agent",
          runtimeReady: true,
          defaultTarget: { providerId: "old-provider", model: "old-model" },
          primaryTarget: { providerId: "old-provider", model: "old-model" },
          backupTarget: null,
          currentMode: "primary",
          autoFailover: true,
          parallelEnabled: false,
          parallelStrategy: "compare",
          parallelTargets: [{ providerId: "old-provider", model: "old-model" }],
        },
      ],
      channels: [],
      switchLogs: [],
    },
    providers,
  );

  const target = { providerId: "newapi-managed-group-cn", model: "mimo-v2.5-pro" };
  const next = applyGlobalTargetToAllModules(state, {
    defaultTarget: target,
    backupTarget: null,
    autoFailover: true,
    parallelEnabled: false,
  });

  expect(next.defaultTarget).toEqual(target);
  expect(next.modules.find((module) => module.moduleId === "chat-main")?.primaryTarget).toEqual(target);
  expect(next.modules.find((module) => module.moduleId === "agent-chat")?.primaryTarget).toEqual(target);
});
