import { expect, test } from "vitest";

import { buildNewApiSyncPayload } from "@/components/workspace/settings/hooks/use-new-api-sync";
import type { NewApiSyncGroupItem } from "@/core/ai/useAiSettingsApi";

function group(groupId: string): NewApiSyncGroupItem {
  return {
    group_id: groupId,
    name: groupId,
    models: [],
    model_count: 0,
    provider_id: `newapi-managed-${groupId}`,
    already_synced: false,
    has_api_key: false,
  };
}

test("NewAPI sync payload falls back to all discovered groups when selection is empty", () => {
  const payload = buildNewApiSyncPayload(new Set(), "", [group("default"), group("vip")]);

  expect(payload).toEqual({
    groups: ["default", "vip"],
    manual_groups: [],
  });
});

test("NewAPI sync payload respects explicit selection and manual groups", () => {
  const payload = buildNewApiSyncPayload(new Set(["default"]), "vip, svip", [
    group("default"),
    group("charity"),
  ]);

  expect(payload).toEqual({
    groups: ["default"],
    manual_groups: ["vip", "svip"],
  });
});
