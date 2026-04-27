import { expect, test } from "vitest";

import { shouldShowFollowups } from "@/components/workspace/input-box-logic";

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
