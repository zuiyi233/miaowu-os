export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = text.length - chineseCount;
  return Math.ceil(chineseCount * 1.2 + otherCount * 0.3);
}

export function estimateTokensBatch(texts: string[]): number[] {
  return texts.map((text) => estimateTokens(text));
}

export function getTokenUsageRatio(text: string, limit: number): number {
  return Math.min(estimateTokens(text) / limit, 1);
}

export function truncateToTokenLimit(text: string, maxTokens: number): string {
  if (!text || estimateTokens(text) <= maxTokens) return text;
  const estimatedCharLimit = Math.floor(maxTokens / 1.2);
  let truncateAt = estimatedCharLimit;
  const sentenceEnders = /[。！？.!?]/g;
  let match;
  while ((match = sentenceEnders.exec(text)) !== null) {
    if (match.index > estimatedCharLimit && match.index < text.length) {
      truncateAt = match.index + 1;
      break;
    }
  }
  return text.slice(0, truncateAt) + "\n\n[...内容已根据 token 限制自动截断...]";
}
