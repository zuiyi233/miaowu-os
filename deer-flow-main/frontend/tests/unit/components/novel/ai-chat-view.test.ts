import { expect, test } from "vitest";

import {
  resolveExecutionModeEnabled,
  shouldShowConfirmationCard,
} from "@/components/novel/ai/AiChatView";
import type { ActionProtocol, SessionBrief } from "@/core/ai/global-ai-service";


test("resolveExecutionModeEnabled prefers execution_gate runtime state", () => {
  const session: SessionBrief = {
    mode: "manage",
    status: "collecting",
    execution_gate: {
      status: "execution_mode_active",
      execution_mode: true,
      pending_action: null,
      confirmation_required: false,
    },
  };

  expect(resolveExecutionModeEnabled(session)).toBe(true);
});


test("resolveExecutionModeEnabled falls back to action_protocol execution_mode payload", () => {
  const session: SessionBrief = {
    mode: "manage",
    status: "collecting",
    action_protocol: {
      action_type: "manage_session",
      slot_schema: {},
      missing_slots: [],
      confirmation_required: false,
      execution_mode: { enabled: true, status: "execution_mode_active" },
      pending_action: null,
      execute_result: null,
    },
  };

  expect(resolveExecutionModeEnabled(session)).toBe(true);
});


test("shouldShowConfirmationCard prioritizes ui_hints over legacy confirmation_required", () => {
  const protocol: ActionProtocol = {
    action_type: "create_novel",
    slot_schema: {},
    missing_slots: [],
    confirmation_required: false,
    execution_mode: null,
    pending_action: null,
    execute_result: null,
    ui_hints: {
      show_confirmation_card: true,
      show_execution_toggle: true,
      quick_actions: ["__enter_execution_mode__"],
    },
  };

  expect(
    shouldShowConfirmationCard(protocol, {
      role: "assistant",
      confirmationDismissed: false,
    })
  ).toBe(true);
});
