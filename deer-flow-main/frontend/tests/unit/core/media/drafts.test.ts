import { expect, test } from "vitest";

import {
  applyOptimisticDraftHide,
  rollbackOptimisticDraftHide,
} from "@/core/media/drafts";

test("applyOptimisticDraftHide adds draft id once", () => {
  const hidden = applyOptimisticDraftHide({}, "draft-1");
  expect(hidden).toEqual({ "draft-1": true });

  const hiddenTwice = applyOptimisticDraftHide(hidden, "draft-1");
  expect(hiddenTwice).toBe(hidden);
});

test("rollbackOptimisticDraftHide removes draft id and preserves unrelated entries", () => {
  const hidden = {
    "draft-1": true,
    "draft-2": true,
  };
  const rollback = rollbackOptimisticDraftHide(hidden, "draft-1");

  expect(rollback).toEqual({ "draft-2": true });

  const untouched = rollbackOptimisticDraftHide(rollback, "missing");
  expect(untouched).toBe(rollback);
});
