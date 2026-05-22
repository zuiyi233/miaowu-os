import { afterEach, expect, test, vi } from "vitest";

import {
  buildChatRequestContext,
  extractStructuredResponse,
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

test("extractStructuredResponse keeps top-level action protocol and ui hints", () => {
  const structured = extractStructuredResponse({
    content: "ok",
    action_protocol: {
      action_type: "create_novel",
      slot_schema: {},
      missing_slots: [],
      confirmation_required: true,
      execution_mode: { status: "readonly", enabled: false },
      pending_action: null,
      execute_result: null,
      decision: {
        intent: "execute",
        execute_confidence: 0.88,
        qa_confidence: 0.12,
        ambiguity: 0.24,
        slots_complete: true,
        should_execute_now: false,
      },
      ui_hints: {
        show_confirmation_card: true,
        show_execution_toggle: true,
        quick_actions: ["__enter_execution_mode__"],
      },
    },
  });

  expect(structured.action_protocol?.decision?.intent).toBe("execute");
  expect(structured.action_protocol?.ui_hints?.show_confirmation_card).toBe(true);
});

test("extractStructuredResponse attaches top-level action protocol to session fallback", () => {
  const structured = extractStructuredResponse({
    content: "ok",
    session: {
      mode: "manage",
      status: "collecting",
    },
    action_protocol: {
      action_type: "manage_session",
      slot_schema: {},
      missing_slots: [],
      confirmation_required: false,
      execution_mode: null,
      pending_action: null,
      execute_result: null,
    },
  });

  expect(structured.session?.action_protocol?.action_type).toBe("manage_session");
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
