'use client';

import { Download, Send, Wrench } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import type {
  AiStructuredResponse,
  DomainToolCall,
  SessionBrief,
} from '@/core/ai/global-ai-service';
import { getBackendBaseURL } from '@/core/config';
import { useI18n } from '@/core/i18n/hooks';
import { useAiPanelStore } from '@/core/novel';
import { NOVEL_AI_MODULE_IDS, novelAiService } from '@/core/novel/ai-service';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  structured?: AiStructuredResponse;
}

const SESSION_MODE_LABELS: Record<string, string> = {
  normal: '',
  create: '📝 创建小说中',
  manage: '🔧 管理小说中',
};

const SESSION_STATUS_LABELS: Record<string, string> = {
  collecting: '收集信息',
  awaiting_confirmation: '等待确认',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  duplicate: '重复提交',
};

function extractDownloadPath(structured?: AiStructuredResponse): string | null {
  if (!structured || typeof structured.novel !== 'object' || structured.novel === null) {
    return null;
  }
  const raw = (structured.novel as Record<string, unknown>).download_path;
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim();
  return normalized ? normalized : null;
}

function resolveDownloadUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getBackendBaseURL()}${normalized}`;
}

function resolveStructuredToolCalls(
  structured?: AiStructuredResponse,
): DomainToolCall[] {
  if (!structured || !Array.isArray(structured.tool_calls)) {
    return [];
  }
  return structured.tool_calls.filter(
    (toolCall): toolCall is DomainToolCall =>
      typeof toolCall?.name === 'string' && toolCall.name.trim().length > 0,
  );
}

function formatToolCallArgsPreview(args: Record<string, unknown>): string {
  const preferredKeys = ['title', 'novel_id', 'project_id', 'step', 'genre'];
  for (const key of preferredKeys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return `${key}=${value.trim().slice(0, 40)}`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `${key}=${String(value)}`;
    }
  }

  const entries = Object.entries(args).filter(([, value]) => {
    return (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  });
  if (entries.length === 0) {
    return '';
  }
  return entries
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value).slice(0, 30)}`)
    .join(', ');
}

function mergeStructuredResponse(
  previous: AiStructuredResponse | undefined,
  next: AiStructuredResponse,
): AiStructuredResponse {
  if (!previous) {
    return next;
  }

  const mergedToolCalls: DomainToolCall[] = [];
  const dedupeSet = new Set<string>();
  const appendToolCalls = (calls: DomainToolCall[] | undefined) => {
    if (!Array.isArray(calls)) {
      return;
    }
    for (const call of calls) {
      const argsKey = (() => {
        try {
          return JSON.stringify(call.args ?? {});
        } catch {
          return '[unserializable_args]';
        }
      })();
      const dedupeKey = `${call.id || ''}|${call.name}|${argsKey}`;
      if (dedupeSet.has(dedupeKey)) {
        continue;
      }
      dedupeSet.add(dedupeKey);
      mergedToolCalls.push(call);
    }
  };

  appendToolCalls(previous.tool_calls);
  appendToolCalls(next.tool_calls);

  const merged: AiStructuredResponse = {
    ...previous,
    ...next,
    content: next.content || previous.content,
    session: next.session ?? previous.session,
    context: {
      ...(previous.context ?? {}),
      ...(next.context ?? {}),
    },
    novel: {
      ...(previous.novel ?? {}),
      ...(next.novel ?? {}),
    },
  };

  if (mergedToolCalls.length > 0) {
    merged.tool_calls = mergedToolCalls;
  } else {
    delete merged.tool_calls;
  }

  return merged;
}

export function AiChatView({ novelId }: { novelId: string }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionBrief | null>(null);
  const { t } = useI18n();
  const aiStream = useAiPanelStore((s) => s.aiStream);
  const selectedText = useAiPanelStore((s) => s.selectedText);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userInput = input.trim();
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    const assistantMessageId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      },
    ]);
    setIsSending(true);

    try {
      await novelAiService.chat(
        {
          messages: [
            {
              role: 'system',
              content: `你是小说创作助手。当前小说ID：${novelId}。请给出简洁、可执行建议。`,
            },
            {
              role: 'user',
              content: selectedText
                ? `选中文本：${selectedText}\n\n用户问题：${userInput}`
                : userInput,
            },
          ],
          moduleId: NOVEL_AI_MODULE_IDS.chat,
          context: {
            moduleId: NOVEL_AI_MODULE_IDS.chat,
            module_id: NOVEL_AI_MODULE_IDS.chat,
          },
          novelId,
          stream: true,
        },
        {
          onChunk: (chunk) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: `${msg.content}${chunk}` }
                  : msg
              )
            );
          },
          onStructured: (data) => {
            if (data.session) {
              setActiveSession(data.session);
            }
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      structured: mergeStructuredResponse(msg.structured, data),
                    }
                  : msg
              )
            );
          },
          onError: () => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: 'AI 请求失败，请稍后重试。' }
                  : msg
              )
            );
          },
        }
      );
    } finally {
      setIsSending(false);
    }
  };

  const sessionModeLabel = activeSession
    ? SESSION_MODE_LABELS[activeSession.mode] || ''
    : '';
  const sessionStatusLabel = activeSession
    ? SESSION_STATUS_LABELS[activeSession.status] || activeSession.status
    : '';

  return (
    <div className="flex h-full flex-col">
      {selectedText && (
        <div className="border-b p-2 text-xs text-muted-foreground">
          {t.novel.selectedText}: {selectedText.slice(0, 100)}...
        </div>
      )}
      {activeSession && activeSession.mode !== 'normal' && (
        <div className="border-b bg-primary/5 px-3 py-1.5 text-xs text-primary flex items-center gap-2">
          <span className="font-medium">{sessionModeLabel}</span>
          <span className="text-muted-foreground">· {sessionStatusLabel}</span>
          {activeSession.active_project?.title && (
            <span className="text-muted-foreground">
              · 项目：{activeSession.active_project.title}
            </span>
          )}
          {activeSession.missing_field && (
            <span className="text-amber-600">
              · 待填：{activeSession.missing_field}
            </span>
          )}
        </div>
      )}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 && aiStream.isStreaming ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {t.novel.aiThinking}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {(() => {
                  const downloadPath = extractDownloadPath(msg.structured);
                  const downloadUrl = downloadPath ? resolveDownloadUrl(downloadPath) : null;
                  const toolCalls = resolveStructuredToolCalls(msg.structured);
                  const displayContent =
                    msg.content.trim() ||
                    (msg.role === 'assistant' && toolCalls.length > 0
                      ? '已触发工具调用，正在处理中…'
                      : '');
                  return (
                    <div>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        {displayContent}
                      </div>
                      {msg.role === 'assistant' && toolCalls.length > 0 ? (
                        <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-background/60 p-2 text-xs text-muted-foreground">
                          {toolCalls.map((toolCall, index) => {
                            const preview = formatToolCallArgsPreview(toolCall.args);
                            return (
                              <div
                                key={`${msg.id}-${toolCall.id || toolCall.name}-${index}`}
                                className="flex items-center gap-1"
                              >
                                <Wrench className="h-3 w-3 shrink-0" />
                                <span className="font-medium text-foreground/90">
                                  {toolCall.name}
                                </span>
                                {preview ? <span className="truncate">· {preview}</span> : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {msg.role === 'assistant' && downloadUrl ? (
                        <div className="mt-2">
                          <Button asChild size="sm" variant="outline">
                            <a href={downloadUrl} download>
                              <Download className="mr-1 h-3.5 w-3.5" />
                              下载导出包
                            </a>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.novel.typeMessage}
            className="min-h-[40px] resize-none"
            disabled={isSending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button size="icon" onClick={handleSend} disabled={!input.trim() || isSending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
