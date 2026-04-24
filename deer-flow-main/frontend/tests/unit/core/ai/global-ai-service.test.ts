import { expect, test } from "vitest";

import {
  buildChatRequestContext,
  mergeSystemPromptIntoMessages,
  resolveNonStreamContent,
  type AiMessage,
} from "@/core/ai/global-ai-service";

test("mergeSystemPromptIntoMessages prepends system message when original message list has none", () => {
  const input: AiMessage[] = [{ role: "user", content: "hello" }];

  const result = mergeSystemPromptIntoMessages(input, "system-rules");

  expect(result).toEqual([
    { role: "system", content: "system-rules" },
    { role: "user", content: "hello" },
  ]);
});

test("mergeSystemPromptIntoMessages merges into existing system messages", () => {
  const input: AiMessage[] = [
    { role: "system", content: "original-system" },
    { role: "user", content: "hello" },
  ];

  const result = mergeSystemPromptIntoMessages(input, "global-system");

  expect(result).toEqual([
    { role: "system", content: "global-system\n\noriginal-system" },
    { role: "user", content: "hello" },
  ]);
});

test("buildChatRequestContext keeps origin context and appends novel id aliases", () => {
  const result = buildChatRequestContext({ thread_id: "t-1" }, "novel-9");

  expect(result).toEqual({
    thread_id: "t-1",
    novelId: "novel-9",
    novel_id: "novel-9",
  });
});

test("resolveNonStreamContent prefers top-level content and falls back to message content", () => {
  expect(
    resolveNonStreamContent({
      content: "top-level",
      message: { content: "fallback" },
    })
  ).toBe("top-level");

  expect(
    resolveNonStreamContent({
      message: { content: "message-level" },
    })
  ).toBe("message-level");
});
