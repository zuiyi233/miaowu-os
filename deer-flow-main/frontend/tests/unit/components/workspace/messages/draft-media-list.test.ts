import { expect, test } from "vitest";

import { computeDraftMediaVirtualSlice } from "@/components/workspace/messages/draft-media-list";

test("computeDraftMediaVirtualSlice returns empty slice for empty list", () => {
  expect(
    computeDraftMediaVirtualSlice({
      total: 0,
      scrollTop: 0,
      viewportHeight: 720,
    })
  ).toEqual({
    startIndex: 0,
    endIndex: 0,
    paddingTop: 0,
    paddingBottom: 0,
  });
});

test("computeDraftMediaVirtualSlice computes visible window and paddings", () => {
  const slice = computeDraftMediaVirtualSlice({
    total: 100,
    scrollTop: 5000,
    viewportHeight: 700,
    rowEstimate: 400,
    overscan: 2,
  });

  expect(slice.startIndex).toBe(10);
  expect(slice.endIndex).toBe(16);
  expect(slice.paddingTop).toBe(4000);
  expect(slice.paddingBottom).toBe(33600);
});
