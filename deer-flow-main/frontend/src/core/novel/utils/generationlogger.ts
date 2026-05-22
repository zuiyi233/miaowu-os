export interface GenerationLog {
  id: string; timestamp: Date; taskType: "volumes" | "chapters";
  input: { novelTitle: string; prompt: string; selectedGenres?: string[]; selectedTags?: string[]; systemPrompt?: string; };
  output: { rawContent: string; parsedContent?: any; success: boolean; error?: string; repairAttempts: number; };
  metadata: { model: string; provider: string; tokensUsed?: { prompt: number; completion: number; total: number; }; duration: number; retryCount: number; };
}

export interface GenerationError {
  type: "network" | "parsing" | "validation" | "api_limit" | "unknown";
  message: string; details?: any; recoverable: boolean; userMessage: string;
}

class GenerationLogger {
  private logs: GenerationLog[] = [];
  private maxLogs = 50;

  startGeneration(taskType: "volumes" | "chapters", input: GenerationLog["input"], model: string, provider: string): string {
    const id = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.logs.unshift({ id, timestamp: new Date(), taskType, input, output: { rawContent: "", success: false, repairAttempts: 0 }, metadata: { model, provider, duration: 0, retryCount: 0 } });
    if (this.logs.length > this.maxLogs) this.logs = this.logs.slice(0, this.maxLogs);
    return id;
  }

  logRawOutput(id: string, content: string): void { const log = this.findLog(id); if (log) log.output.rawContent = content; }

  logParsingResult(id: string, parsedContent: any, success: boolean, error?: string, repairAttempts = 0): void {
    const log = this.findLog(id);
    if (log) { log.output.parsedContent = parsedContent; log.output.success = success; log.output.error = error; log.output.repairAttempts = repairAttempts; }
  }

  logTokenUsage(id: string, usage: { prompt: number; completion: number; total: number }): void { const log = this.findLog(id); if (log) log.metadata.tokensUsed = usage; }
  completeGeneration(id: string): void { const log = this.findLog(id); if (log) log.metadata.duration = Date.now() - log.timestamp.getTime(); }
  logRetry(id: string): void { const log = this.findLog(id); if (log) log.metadata.retryCount += 1; }

  analyzeError(error: any, rawContent?: string): GenerationError {
    const msg = error?.message || String(error);
    if (msg.includes("JSON") || msg.includes("parse")) return { type: "parsing", message: msg, details: { rawContent: rawContent?.substring(0, 500) }, recoverable: true, userMessage: "AI生成的内容格式有误，正在尝试修复..." };
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("timeout")) return { type: "network", message: msg, recoverable: true, userMessage: "网络连接出现问题，请检查网络后重试。" };
    if ((msg.includes("rate limit") || msg.includes("quota") || msg.includes("token")) && !msg.includes("JSON")) return { type: "api_limit", message: msg, recoverable: true, userMessage: "API调用次数已达限制，请稍后重试。" };
    return { type: "unknown", message: msg, recoverable: false, userMessage: "生成过程中出现未知错误，请重试。" };
  }

  getStatistics() {
    const total = this.logs.length, successful = this.logs.filter((l) => l.output.success).length;
    return { total, successful, failed: total - successful, successRate: total > 0 ? (successful / total) * 100 : 0 };
  }

  private findLog(id: string): GenerationLog | undefined { return this.logs.find((l) => l.id === id); }
}

export const generationLogger = new GenerationLogger();

export function createUserFriendlyMessage(error: GenerationError, rawContent?: string): string {
  let msg = error.userMessage;
  if (error.type === "parsing" && rawContent) msg += `\n\nAI生成了以下内容但格式有误：\n${rawContent.substring(0, 200)}${rawContent.length > 200 ? "..." : ""}`;
  if (error.recoverable) msg += '\n\n点击"重试"按钮可以重新生成。';
  return msg;
}

export function formatDuration(ms: number): string { return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}min`; }
export function formatTokens(tokens: number): string { return tokens < 1000 ? `${tokens}` : tokens < 1000000 ? `${(tokens / 1000).toFixed(1)}K` : `${(tokens / 1000000).toFixed(1)}M`; }
