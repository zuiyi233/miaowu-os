export function extractMentionedIds(htmlContent: string): string[] {
  if (!htmlContent) return [];
  const regex = /data-type="mention"[^>]*data-id="([^"]*)"/g;
  const ids = new Set<string>();
  let match;
  while ((match = regex.exec(htmlContent)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

export function getPlainTextSnippet(html: string, maxLength: number = 100): string {
  if (typeof window === "undefined") {
    return html.length > maxLength ? html.slice(0, maxLength) + "..." : html;
  }
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const text = tempDiv.textContent || tempDiv.innerText || "";
  return text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
}

export function extractChapterGoal(htmlContent: string): string | null {
  if (!htmlContent) return null;
  const standardMatch = htmlContent.match(
    /<blockquote>[\s\S]*?<strong>.*?细纲.*?<\/strong>[\s\S]*?<br>([\s\S]*?)<\/blockquote>/i
  );
  if (standardMatch?.[1]) return standardMatch[1].replace(/<[^>]+>/g, "").trim();
  const simpleMatch = htmlContent.match(/^\s*<blockquote>([\s\S]*?)<\/blockquote>/i);
  if (simpleMatch?.[1]) return simpleMatch[1].replace(/<[^>]+>/g, "").trim();
  return null;
}

export function cleanNovelContent(html: string): string {
  if (!html) return "";
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  tempDiv.querySelectorAll("script, style").forEach((node) => node.remove());
  let text = tempDiv.textContent || tempDiv.innerText || "";
  return text.replace(/\n\s*\n/g, "\n\n").replace(/[ \t]+/g, " ").trim();
}
