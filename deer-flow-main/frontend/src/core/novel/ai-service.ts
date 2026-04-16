const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface AiMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiRequestOptions {
  messages: AiMessage[];
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

export class NovelAiService {
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async chat(options: AiRequestOptions, callbacks?: AiStreamCallbacks): Promise<string> {
    const { messages, stream = true } = options;

    this.abortController = new AbortController();

    const signal = callbacks?.abortSignal
      ? AbortSignal.any([this.abortController.signal, callbacks.abortSignal])
      : this.abortController.signal;

    try {
      const response = await fetch(`${this.baseUrl}/api/novel/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, stream }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      if (!stream) {
        const data = await response.json();
        const content = data.content || data.message?.content || '';
        callbacks?.onComplete?.(content);
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
                callbacks?.onChunk?.(content);
              }
            } catch {
              if (data.trim()) {
                fullText += data;
                callbacks?.onChunk?.(data);
              }
            }
          }
        }
      }

      callbacks?.onComplete?.(fullText);
      return fullText;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        callbacks?.onAbort?.();
        return '';
      }
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks?.onError?.(err);
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

  async continueWriting(currentContent: string, context: Record<string, any>, signal?: AbortSignal): Promise<string> {
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
