export function repairJson(jsonString: string): string {
  if (!jsonString || typeof jsonString !== "string") return jsonString;
  let repaired = jsonString.trim();
  repaired = repaired.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  repaired = repaired.replace(/\/\/.*$/gm, "");
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, "");
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");
  const firstBrace = repaired.indexOf("{");
  const firstBracket = repaired.indexOf("[");
  const jsonStart = Math.min(
    firstBrace === -1 ? Infinity : firstBrace,
    firstBracket === -1 ? Infinity : firstBracket
  );
  if (jsonStart !== Infinity) {
    const afterJsonStart = repaired.substring(jsonStart);
    let braceCount = 0, bracketCount = 0, jsonEnd = -1;
    for (let i = 0; i < afterJsonStart.length; i++) {
      const char = afterJsonStart[i];
      if (char === "{") braceCount++;
      else if (char === "}") braceCount--;
      else if (char === "[") bracketCount++;
      else if (char === "]") bracketCount--;
      if (braceCount === 0 && bracketCount === 0) { jsonEnd = i + 1; break; }
    }
    if (jsonEnd !== -1) repaired = afterJsonStart.substring(0, jsonEnd);
    else repaired = afterJsonStart;
  }
  return fixUnclosedBrackets(repaired);
}

function fixUnclosedBrackets(jsonString: string): string {
  let result = jsonString;
  let braceCount = 0, bracketCount = 0, inString = false, escapeNext = false;
  for (let i = 0; i < result.length; i++) {
    const char = result[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === "\\") { escapeNext = true; continue; }
    if (char === '"' && !escapeNext) { inString = !inString; continue; }
    if (!inString) {
      if (char === "{") braceCount++;
      else if (char === "}") braceCount--;
      else if (char === "[") bracketCount++;
      else if (char === "]") bracketCount--;
    }
  }
  if (inString) result += '"';
  while (braceCount > 0) { result += "}"; braceCount--; }
  while (bracketCount > 0) { result += "]"; bracketCount--; }
  return result;
}

export function safeJsonParse<T = any>(
  jsonString: string,
  options: { enableRepair?: boolean; fallbackToTextExtraction?: boolean } = {}
): T | null {
  const { enableRepair = true, fallbackToTextExtraction = true } = options;
  if (!jsonString || typeof jsonString !== "string") return null;
  try { return JSON.parse(jsonString); } catch {}
  if (!enableRepair) return null;
  try { const repaired = repairJson(jsonString); return JSON.parse(repaired); } catch {}
  if (!fallbackToTextExtraction) return null;
  try { return extractJsonFromText(jsonString) as T; } catch { return null; }
}

function extractJsonFromText(text: string): any {
  const arrayMatch = /\[[\s\S]*\]/.exec(text);
  if (arrayMatch) { try { return JSON.parse(arrayMatch[0]); } catch {} }
  const objectMatch = /\{[\s\S]*\}/.exec(text);
  if (objectMatch) { try { return JSON.parse(objectMatch[0]); } catch {} }
  return parseSimpleKeyValuePairs(text);
}

function parseSimpleKeyValuePairs(text: string): any {
  const result: any = [];
  const itemPattern = /\{\s*"title"\s*:\s*"([^"]+)"\s*,\s*"desc"\s*:\s*"([^"]+)"\s*\}/g;
  let match;
  while ((match = itemPattern.exec(text)) !== null) {
    result.push({ title: match[1], desc: match[2] });
  }
  return result.length > 0 ? result : null;
}

export function validateJsonStructure(
  data: any,
  expectedStructure: "array" | "object" | "volumeArray" | "chapterArray"
): { isValid: boolean; error?: string } {
  if (!data) return { isValid: false, error: "数据为空" };
  switch (expectedStructure) {
    case "array":
      if (!Array.isArray(data)) return { isValid: false, error: "期望数组格式" };
      break;
    case "object":
      if (typeof data !== "object" || Array.isArray(data)) return { isValid: false, error: "期望对象格式" };
      break;
    case "volumeArray":
    case "chapterArray":
      if (!Array.isArray(data)) return { isValid: false, error: "期望数组格式" };
      for (let i = 0; i < data.length; i++) {
        if (!data[i].title || typeof data[i].title !== "string") return { isValid: false, error: `第${i + 1}项缺少有效的title字段` };
        if (!data[i].desc || typeof data[i].desc !== "string") return { isValid: false, error: `第${i + 1}项缺少有效的desc字段` };
      }
      break;
  }
  return { isValid: true };
}
