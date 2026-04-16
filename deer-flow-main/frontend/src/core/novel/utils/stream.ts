export async function* parseSseStream<T>(stream: ReadableStream): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data: ")) {
          try {
            const jsonStr = line.substring(6);
            if (jsonStr === "[DONE]") continue;
            yield JSON.parse(jsonStr) as T;
          } catch { }
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
