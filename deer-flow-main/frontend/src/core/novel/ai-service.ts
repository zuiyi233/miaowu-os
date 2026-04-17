import { getBackendBaseURL } from '@/core/config';

import { aiEventBus } from './ai-event-bus';
import { emitNovelEvent } from './observability';

const API_BASE_URL = getBackendBaseURL();

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiRequestOptions {
  messages: AiMessage[];
  novelId?: string;
  context?: Record<string, any>;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface AiStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onAbort?: () => void;
  abortSignal?: AbortSignal;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 120000;

function mergeAbortSignals(signals: ReadonlyArray<AbortSignal | null | undefined>): AbortSignal | undefined {
  const validSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (validSignals.length === 0) return undefined;
  if (validSignals.length === 1) return validSignals[0];

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(validSignals);
  }

  const fallbackController = new AbortController();
  const onAbort = () => fallbackController.abort();
  for (const signal of validSignals) {
    if (signal.aborted) {
      fallbackController.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return fallbackController.signal;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const signal = mergeAbortSignals([controller.signal, options.signal]);
    const response = await fetch(url, {
      ...options,
      signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(url: string, options: RequestInit, retries: number = MAX_RETRIES): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.ok) return response;
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('Unknown error');
}

export class NovelAiService {
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async chat(options: AiRequestOptions, callbacks?: AiStreamCallbacks): Promise<string> {
    const { messages, stream = true, novelId } = options;

    this.abortController = new AbortController();

    const signal = mergeAbortSignals([this.abortController.signal, callbacks?.abortSignal]) ?? this.abortController.signal;

    const correlationId = `novel-ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const busCallbacks = aiEventBus.toStreamCallbacks(correlationId);

    const mergedCallbacks: AiStreamCallbacks = {
      onChunk: (chunk: string) => {
        callbacks?.onChunk?.(chunk);
        busCallbacks.onChunk?.(chunk);
      },
      onComplete: (fullText: string) => {
        callbacks?.onComplete?.(fullText);
        busCallbacks.onComplete?.(fullText);
      },
      onError: (error: Error) => {
        callbacks?.onError?.(error);
        busCallbacks.onError?.(error);
      },
      onAbort: () => {
        callbacks?.onAbort?.();
        busCallbacks.onAbort?.();
      },
      abortSignal: signal,
    };

    aiEventBus.emit('ai_request_start', {
      requestId: correlationId,
      model: options.model,
      stream,
      novelId,
      messageCount: messages.length,
    });
    aiEventBus.emit('stream_start', { requestId: correlationId, model: options.model, stream, novelId });
    emitNovelEvent('ai_generate_start', {
      requestId: correlationId,
      novelId: novelId ?? '',
      stream,
      model: options.model ?? '',
    });

    try {
      const endpoint = novelId
        ? `${this.baseUrl}/api/novels/${encodeURIComponent(novelId)}/ai/chat`
        : `${this.baseUrl}/api/novel/chat`;

      const response = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          stream,
          context: options.context,
          model_name: options.model,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
        signal,
      });

      if (!stream) {
        const data = await response.json();
        const content = data.content || data.message?.content || '';
        aiEventBus.emit('ai_request_complete', {
          requestId: correlationId,
          novelId,
          outputLength: content.length,
        });
        emitNovelEvent('ai_generate_complete', {
          requestId: correlationId,
          novelId: novelId ?? '',
          outputLength: content.length,
        });
        mergedCallbacks.onComplete?.(content);
        return content;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.content || parsed.delta?.content || parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullText += content;
                mergedCallbacks.onChunk?.(content);
              }
            } catch {
              if (data.trim()) {
                fullText += data;
                mergedCallbacks.onChunk?.(data);
              }
            }
          }
        }
      }

      mergedCallbacks.onComplete?.(fullText);
      aiEventBus.emit('ai_request_complete', {
        requestId: correlationId,
        novelId,
        outputLength: fullText.length,
      });
      emitNovelEvent('ai_generate_complete', {
        requestId: correlationId,
        novelId: novelId ?? '',
        outputLength: fullText.length,
      });
      return fullText;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        mergedCallbacks.onAbort?.();
        aiEventBus.emit('ai_request_error', {
          requestId: correlationId,
          novelId,
          error: 'aborted',
        });
        emitNovelEvent('ai_generate_error', {
          requestId: correlationId,
          novelId: novelId ?? '',
          error: 'aborted',
        });
        return '';
      }
      const err = error instanceof Error ? error : new Error(String(error));
      mergedCallbacks.onError?.(err);
      aiEventBus.emit('ai_request_error', {
        requestId: correlationId,
        novelId,
        error: err.message,
      });
      emitNovelEvent('ai_generate_error', {
        requestId: correlationId,
        novelId: novelId ?? '',
        error: err.message,
      });
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async generateOutline(novelContext: Record<string, any>): Promise<string> {
    return this.chat({
      messages: [
        {
          role: 'system',
          content: '你是一个专业的小说创作助手，擅长帮助作者构建引人入胜的故事大纲。',
        },
        {
          role: 'user',
          content: `请基于以下信息帮助我生成小说大纲：\n${JSON.stringify(novelContext, null, 2)}`,
        },
      ],
    });
  }

  async continueWriting(
    currentContent: string,
    context: Record<string, any>,
    signal?: AbortSignal,
    novelId?: string,
  ): Promise<string> {
    return this.chat({
      messages: [
        {
          role: 'system',
          content: `你是一个小说续写助手。基于以下上下文信息，继续写故事。保持角色性格一致，情节连贯。
上下文：${JSON.stringify(context, null, 2)}`,
        },
        {
          role: 'user',
          content: `请继续以下章节的内容：\n${currentContent}`,
        },
      ],
      novelId,
    }, {
      abortSignal: signal,
    });
  }

  async polishText(text: string, style?: string): Promise<string> {
    return this.chat({
      messages: [
        {
          role: 'system',
          content: `你是一个专业的文字润色助手。${style ? `请使用${style}风格。` : ''}改进文字表达的流畅度、用词准确性和文学性，但不要改变原文的核心意思。`,
        },
        {
          role: 'user',
          content: `请润色以下文字：\n${text}`,
        },
      ],
    });
  }

  async expandScene(sceneDescription: string, context: Record<string, any>): Promise<string> {
    return this.chat({
      messages: [
        {
          role: 'system',
          content: `你是一个场景扩写助手。基于以下角色和世界观信息，将简短的场景描述扩写成详细的叙述。
上下文：${JSON.stringify(context, null, 2)}`,
        },
        {
          role: 'user',
          content: `请扩写以下场景：\n${sceneDescription}`,
        },
      ],
    });
  }

  async condenseText(text: string, signal?: AbortSignal): Promise<string> {
    return this.chat({
      messages: [
        {
          role: 'system',
          content: '你是一个文字精简助手。请将以下段落精简压缩，保留核心情节和关键信息，去除冗余描写。不要改变原文的核心意思。',
        },
        {
          role: 'user',
          content: `请精简以下文字：\n${text}`,
        },
      ],
      stream: true,
    }, {
      abortSignal: signal,
    });
  }

  async rewriteText(text: string, signal?: AbortSignal): Promise<string> {
    return this.chat({
      messages: [
        {
          role: 'system',
          content: '你是一个文字改写助手。请用更加生动、引人入胜的方式重写以下段落，保持原意不变但提升文学性和可读性。',
        },
        {
          role: 'user',
          content: `请重写以下文字：\n${text}`,
        },
      ],
      stream: true,
    }, {
      abortSignal: signal,
    });
  }

  async extractEntities(text: string): Promise<Record<string, any[]>> {
    const response = await this.chat(
      {
        messages: [
          {
            role: 'system',
            content: '你是一个实体提取助手。从文本中提取角色、场景、物品、势力等实体信息。请以JSON格式返回，格式：{"characters": [], "settings": [], "items": [], "factions": []}',
          },
          {
            role: 'user',
            content: `从以下文本中提取实体：\n${text}`,
          },
        ],
        stream: false,
      },
    );

    try {
      return JSON.parse(response);
    } catch {
      return { characters: [], settings: [], items: [], factions: [] };
    }
  }
}

export const novelAiService = new NovelAiService();
