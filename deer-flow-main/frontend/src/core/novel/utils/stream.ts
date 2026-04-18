export async function* parseSseStream<T>(stream: ReadableStream): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseEventBlock = (eventBlock: string): T | null => {
    const dataLines = eventBlock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
      return null;
    }

    const payload = dataLines.join("\n");
    if (!payload || payload === "[DONE]") {
      return null;
    }

    try {
      return JSON.parse(payload) as T;
    } catch {
      return null;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseEventBlock(block);
        if (parsed !== null) {
          yield parsed;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const tailBlocks = buffer.split("\n\n").filter(Boolean);
      for (const block of tailBlocks) {
        const parsed = parseEventBlock(block);
        if (parsed !== null) {
          yield parsed;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function textToHtml(text: string): string {
  return text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
}

export function extractOpenAIContent(data: any): string {
  return data.choices?.[0]?.delta?.content || "";
}

export function extractGeminiContent(data: any): string {
  return data.text || "";
}
