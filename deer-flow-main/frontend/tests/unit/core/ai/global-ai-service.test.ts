import { afterEach, expect, test, vi } from "vitest";

import {
  buildChatRequestContext,
  fetchWithRetry,
  mergeSystemPromptIntoMessages,
  normalizeMaxRetries,
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("normalizeMaxRetries enforces robust boundaries", () => {
  expect(normalizeMaxRetries(2)).toBe(2);
  expect(normalizeMaxRetries(0)).toBe(0);
  expect(normalizeMaxRetries(-5)).toBe(0);
  expect(normalizeMaxRetries(Number.NaN)).toBe(0);
  expect(normalizeMaxRetries(25)).toBe(20);
});

test("fetchWithRetry follows provided retry budget instead of hardcoded attempts", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: vi.fn().mockResolvedValue("temporary"),
    } as unknown as Response)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("ok"),
    } as unknown as Response);

  vi.stubGlobal("fetch", fetchMock);

  await expect(
    fetchWithRetry("http://backend.test/api/ai/chat", { method: "POST" }, 0, 1000, 0)
  ).rejects.toThrow(/API error: 503/);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fetchMock.mockReset();
  fetchMock
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: vi.fn().mockResolvedValue("temporary"),
    } as unknown as Response)
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: vi.fn().mockResolvedValue("temporary"),
    } as unknown as Response)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn().mockResolvedValue("ok"),
    } as unknown as Response);

  await expect(
    fetchWithRetry("http://backend.test/api/ai/chat", { method: "POST" }, 2, 1000, 0)
  ).resolves.toMatchObject({ ok: true, status: 200 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
