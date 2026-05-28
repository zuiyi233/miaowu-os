import { expect, test } from "vitest";

import {
  buildFollowupSuggestionsRequestBody,
  shouldShowFollowups,
} from "@/components/workspace/input-box-logic";

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
