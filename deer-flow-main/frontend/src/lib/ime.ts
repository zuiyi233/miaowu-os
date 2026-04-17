import type { KeyboardEvent } from "react";

export type MaybeKeyboardEvent = {
  nativeEvent?: {
    isComposing?: boolean;
  };
  keyCode?: number;
};

const IME_ENTER_KEYCODE = 229;

export function isIMEComposing(
  event: KeyboardEvent<HTMLElement> | MaybeKeyboardEvent,
  isComposingState?: boolean,
): boolean {
  const nativeComposing = Boolean(event.nativeEvent?.isComposing);
  const fallbackComposing = event.keyCode === IME_ENTER_KEYCODE;
  return Boolean(isComposingState) || nativeComposing || fallbackComposing;
}

export function shouldSubmitOnEnter(
  event: KeyboardEvent<HTMLElement> | MaybeKeyboardEvent,
  isComposingState?: boolean,
): boolean {
  return !isIMEComposing(event, isComposingState);
}
