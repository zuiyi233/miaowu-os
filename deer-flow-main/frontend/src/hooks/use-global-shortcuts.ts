"use client";

import { useEffect } from "react";

type ShortcutAction = () => void;

interface Shortcut {
  key: string;
  meta: boolean;
  shift?: boolean;
  action: ShortcutAction;
}

export function normalizeShortcutKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function isEditableTargetForShortcut(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }

  const elementLike = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  const tagName =
    typeof elementLike.tagName === "string"
      ? elementLike.tagName.toUpperCase()
      : "";

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    elementLike.isContentEditable === true
  );
}

/**
 * Register global keyboard shortcuts on window.
 * Shortcuts are suppressed when focus is inside an input, textarea, or
 * contentEditable element - except for Cmd+K which always fires.
 */
export function useGlobalShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const eventKey = normalizeShortcutKey(event.key);
      if (!eventKey) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;

      for (const shortcut of shortcuts) {
        const shortcutKey = normalizeShortcutKey(shortcut.key);
        if (!shortcutKey) {
          continue;
        }

        if (
          eventKey === shortcutKey &&
          meta === shortcut.meta &&
          (shortcut.shift ?? false) === event.shiftKey
        ) {
          // Allow Cmd+K even in inputs (standard command palette behavior)
          if (
            shortcutKey !== "k" &&
            isEditableTargetForShortcut(event.target)
          ) {
            continue;
          }

          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
