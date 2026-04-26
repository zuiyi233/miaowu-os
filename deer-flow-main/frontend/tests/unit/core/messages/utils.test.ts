import type { Message } from "@langchain/langgraph-sdk";
import { expect, test, vi } from "vitest";

import { groupMessages } from "@/core/messages/utils";

function asMessage(message: Partial<Message>): Message {
  return message as Message;
}

test("groupMessages links tool-first message to later AI processing group", () => {
  const toolFirst = asMessage({
    id: "tool-1",
    type: "tool",
    name: "build_world",
    tool_call_id: "call-build-world-1",
    content: "blocked",
  });
  const aiLater = asMessage({
    id: "ai-1",
    type: "ai",
    content: "",
    tool_calls: [
      {
        id: "call-build-world-1",
        name: "build_world",
        args: { project_id: "proj-1" },
      },
    ],
  });

  const groups = groupMessages([toolFirst, aiLater], (group) => group);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.type).toBe("assistant:processing");
  expect(groups[0]?.messages).toHaveLength(2);
  expect(groups[0]?.messages[0]?.id).toBe("ai-1");
  expect(groups[0]?.messages[1]?.id).toBe("tool-1");
});

test("groupMessages keeps ai-first + tool-later in one processing group", () => {
  const aiFirst = asMessage({
    id: "ai-2",
    type: "ai",
    content: "",
    tool_calls: [
      {
        id: "call-build-world-2",
        name: "build_world",
        args: { project_id: "proj-2" },
      },
    ],
  });
  const toolLater = asMessage({
    id: "tool-2",
    type: "tool",
    name: "build_world",
    tool_call_id: "call-build-world-2",
    content: "ok",
  });

  const groups = groupMessages([aiFirst, toolLater], (group) => group);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.type).toBe("assistant:processing");
  expect(groups[0]?.messages).toHaveLength(2);
});

test("groupMessages keeps unmatched tool message visible without console error", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const orphanTool = asMessage({
      id: "tool-orphan",
      type: "tool",
      name: "build_world",
      tool_call_id: "call-missing",
      content: "需要确认执行",
    });
    const groups = groupMessages([orphanTool], (group) => group);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.type).toBe("assistant");
    expect(groups[0]?.messages[0]?.id).toBe("tool-orphan");
    expect(errorSpy).not.toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
});
