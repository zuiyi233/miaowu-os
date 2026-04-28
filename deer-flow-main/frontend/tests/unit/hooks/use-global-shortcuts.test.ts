import { expect, test } from "vitest";

import {
  isEditableTargetForShortcut,
  normalizeShortcutKey,
} from "@/hooks/use-global-shortcuts";

test("normalizeShortcutKey: 非字符串或空字符串返回 null", () => {
  expect(normalizeShortcutKey(undefined)).toBeNull();
  expect(normalizeShortcutKey(null)).toBeNull();
  expect(normalizeShortcutKey("")).toBeNull();
  expect(normalizeShortcutKey("   ")).toBeNull();
});

test("normalizeShortcutKey: 规范化大小写与空白", () => {
  expect(normalizeShortcutKey("K")).toBe("k");
  expect(normalizeShortcutKey("  Shift+K  ")).toBe("shift+k");
});

test("isEditableTargetForShortcut: INPUT/TEXTAREA/contentEditable 为 true", () => {
  expect(
    isEditableTargetForShortcut({
      tagName: "input",
      isContentEditable: false,
    } as unknown as EventTarget),
  ).toBe(true);

  expect(
    isEditableTargetForShortcut({
      tagName: "TEXTAREA",
      isContentEditable: false,
    } as unknown as EventTarget),
  ).toBe(true);

  expect(
    isEditableTargetForShortcut({
      tagName: "DIV",
      isContentEditable: true,
    } as unknown as EventTarget),
  ).toBe(true);
});

test("isEditableTargetForShortcut: 其他目标返回 false", () => {
  expect(isEditableTargetForShortcut(null)).toBe(false);
  expect(
    isEditableTargetForShortcut({
      tagName: "DIV",
      isContentEditable: false,
    } as unknown as EventTarget),
  ).toBe(false);
  expect(
    isEditableTargetForShortcut({} as unknown as EventTarget),
  ).toBe(false);
});
